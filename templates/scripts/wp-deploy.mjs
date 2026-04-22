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
