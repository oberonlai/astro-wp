#!/usr/bin/env node

/**
 * Local deploy server — listens for WordPress webhooks and triggers
 * astro build + wrangler deploy.
 *
 * Usage: node scripts/wp-deploy.mjs
 *
 * Environment variables (optional):
 *   DEPLOY_PORT    — port to listen on (default: 4000)
 *   DEBOUNCE_MS    — debounce window in ms (default: 5000)
 */

import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = parseInt(process.env.DEPLOY_PORT || "4000", 10);
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || "5000", 10);

let deploying = false;
let pendingDeploy = false;
let debounceTimer = null;

/**
 * Read webhook secret from WordPress plugin generated file or wp-bridge.config.ts.
 */
function getWebhookSecret() {
	// Try to read from wp-bridge.config.ts comment or environment.
	if (process.env.WEBHOOK_SECRET) {
		return process.env.WEBHOOK_SECRET;
	}
	return "";
}

/**
 * Verify HMAC-SHA256 signature from WordPress webhook.
 */
function verifySignature(payload, signature, secret) {
	if (!secret) {
		// No secret configured, skip verification.
		return true;
	}
	const expected = createHmac("sha256", secret).update(payload).digest("hex");
	return signature === expected;
}

/**
 * Run a shell command and stream output.
 */
function runCommand(command, args) {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			cwd: ROOT,
			stdio: "inherit",
			shell: true,
		});
		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
			}
		});
		proc.on("error", reject);
	});
}

/**
 * Run a command, capture stdout, and return it. Does not throw on non-zero
 * exit — callers decide how to react.
 */
function capture(command, args) {
	return new Promise((resolveCap) => {
		const proc = spawn(command, args, { cwd: ROOT, shell: true });
		let out = "";
		let err = "";
		proc.stdout?.on("data", (c) => (out += c.toString()));
		proc.stderr?.on("data", (c) => (err += c.toString()));
		proc.on("close", (code) => resolveCap({ code, stdout: out, stderr: err }));
		proc.on("error", () => resolveCap({ code: 1, stdout: out, stderr: err }));
	});
}

/**
 * Commit and push snapshot + image changes after a build so the
 * Cloudflare Git integration can rebuild from committed files.
 *
 * Paths tracked:
 *   - src/config/wp-snapshot/   (content source of truth)
 *   - public/wp-images/         (referenced by snapshot entries)
 *
 * Skipped silently when the project is not a git repo, when there are
 * no changes to those paths, or when push fails (logged, non-fatal).
 */
async function commitSnapshot() {
	const isRepo = await capture("git", ["rev-parse", "--is-inside-work-tree"]);
	if (isRepo.code !== 0) {
		console.log("  [deploy] Not a git repo, skipping snapshot commit.");
		return;
	}

	const paths = ["src/config/wp-snapshot", "public/wp-images"];
	await capture("git", ["add", "--", ...paths]);

	const diff = await capture("git", ["diff", "--cached", "--quiet", "--", ...paths]);
	if (diff.code === 0) {
		console.log("  [deploy] Snapshot unchanged, skipping commit.");
		return;
	}

	const count = await capture("git", [
		"diff",
		"--cached",
		"--name-only",
		"--",
		"src/config/wp-snapshot/posts",
	]);
	const changed = count.stdout.split("\n").filter(Boolean).length;
	const msg = `content(wp): 同步 ${changed} 篇文章快照`;

	const commit = await capture("git", ["commit", "-m", msg]);
	if (commit.code !== 0) {
		console.error("  [deploy] Snapshot commit failed:", commit.stderr.trim());
		return;
	}
	console.log(`  [deploy] Snapshot committed: ${msg}`);

	const push = await capture("git", ["push"]);
	if (push.code !== 0) {
		console.error("  [deploy] Snapshot push failed (will retry next time):", push.stderr.trim());
		return;
	}
	console.log("  [deploy] Snapshot pushed to remote.");
}

/**
 * Execute build and deploy pipeline.
 */
async function deploy() {
	if (deploying) {
		pendingDeploy = true;
		console.log("  [deploy] Build in progress, queued for next run.");
		return;
	}

	deploying = true;
	const startTime = Date.now();

	try {
		console.log("\n  [deploy] Starting astro build...");
		await runCommand("npm", ["run", "build"]);

		console.log("  [deploy] Committing snapshot + images to git...");
		await commitSnapshot();

		console.log("  [deploy] Build complete. Deploying to Cloudflare...");
		await runCommand("npx", ["wrangler", "deploy"]);

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		console.log(`  [deploy] Deploy complete in ${elapsed}s.\n`);
	} catch (err) {
		console.error(`  [deploy] Failed: ${err.message}\n`);
	} finally {
		deploying = false;

		// If another webhook came in during build, run again.
		if (pendingDeploy) {
			pendingDeploy = false;
			console.log("  [deploy] Processing queued deploy...");
			deploy();
		}
	}
}

/**
 * Debounced deploy — waits for rapid saves to settle.
 */
function scheduleDeploy() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		deploy();
	}, DEBOUNCE_MS);
	console.log(`  [deploy] Debouncing... will trigger in ${DEBOUNCE_MS / 1000}s`);
}

/**
 * HTTP request handler.
 */
function handleRequest(req, res) {
	// Health check.
	if (req.method === "GET" && req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", deploying }));
		return;
	}

	// Webhook endpoint.
	if (req.method === "POST" && req.url === "/webhook") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			const signature = req.headers["x-astro-signature"] || "";
			const event = req.headers["x-astro-event"] || "unknown";
			const secret = getWebhookSecret();

			if (secret && !verifySignature(body, signature, secret)) {
				console.log("  [webhook] Invalid signature, rejecting.");
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "invalid signature" }));
				return;
			}

			let payload = {};
			try {
				payload = JSON.parse(body);
			} catch {
				// Empty or invalid JSON is fine for deploy hooks.
			}

			console.log(`  [webhook] Received event: ${event}, post: ${payload.slug || "n/a"}`);

			scheduleDeploy();

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: true, event }));
		});
		return;
	}

	res.writeHead(404);
	res.end("Not found");
}

// Start server.
const server = createServer(handleRequest);
server.listen(PORT, () => {
	console.log(`\n  [deploy-server] Listening on http://localhost:${PORT}`);
	console.log(`  [deploy-server] Webhook endpoint: http://localhost:${PORT}/webhook`);
	console.log(`  [deploy-server] Health check:     http://localhost:${PORT}/health`);
	console.log(`  [deploy-server] Debounce: ${DEBOUNCE_MS / 1000}s\n`);
});
