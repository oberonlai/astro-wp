#!/usr/bin/env node

/**
 * Expose the local WordPress Playground via Cloudflare Tunnel so external
 * users (editors, clients, Astro build pipeline) can reach it.
 *
 * Two modes:
 *   - Quick (default): temporary trycloudflare.com URL, zero setup, changes every start.
 *   - Permanent: fixed hostname on a Cloudflare-managed domain. Triggered when
 *     tunnel.hostname is set in wp-bridge.config.ts.
 *
 * Cross-platform: uses the npm `cloudflared` package which auto-downloads the
 * correct binary for macOS / Linux / Windows.
 *
 * Usage:
 *   node scripts/wp-tunnel.mjs
 *   node scripts/wp-tunnel.mjs --hostname=wp.example.com
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CF_DIR = join(homedir(), ".cloudflared");
const CERT_PATH = join(CF_DIR, "cert.pem");

const args = process.argv.slice(2);
const hostnameArg = args.find((a) => a.startsWith("--hostname="))?.split("=")[1];

/**
 * Load wp-bridge.config.ts to read WordPress port and tunnel hostname.
 */
async function loadConfig() {
	const tsConfigPath = resolve(ROOT, "wp-bridge.config.ts");
	if (!existsSync(tsConfigPath)) {
		return { port: 8888, hostname: "" };
	}

	// Naive TS parse: extract url and tunnel.hostname via regex — avoids needing
	// a TS runtime in this script.
	const src = readFileSync(tsConfigPath, "utf-8");
	const urlMatch = src.match(/url:\s*["']([^"']+)["']/);
	const hostnameMatch = src.match(/hostname:\s*["']([^"']*)["']/);

	let port = 8888;
	if (urlMatch) {
		const portMatch = urlMatch[1].match(/:(\d+)/);
		if (portMatch) port = parseInt(portMatch[1], 10);
	}

	return {
		port,
		hostname: hostnameMatch ? hostnameMatch[1] : "",
	};
}

/**
 * Resolve the cloudflared binary path from the npm package.
 */
async function resolveCloudflared() {
	try {
		const mod = await import("cloudflared");
		return mod.bin;
	} catch {
		console.error("  ✗ cloudflared npm package not found. Run: npm install cloudflared");
		process.exit(1);
	}
}

/**
 * Run a cloudflared subcommand and wait for exit.
 */
function runSync(bin, cmdArgs) {
	const result = spawnSync(bin, cmdArgs, { stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`cloudflared ${cmdArgs.join(" ")} failed (exit ${result.status}).`);
	}
}

/**
 * Run cloudflared in the foreground (streams logs, blocks until killed).
 */
function runForeground(bin, cmdArgs) {
	const child = spawn(bin, cmdArgs, { stdio: "inherit" });
	child.on("exit", (code) => process.exit(code ?? 0));
	process.on("SIGINT", () => child.kill("SIGINT"));
	process.on("SIGTERM", () => child.kill("SIGTERM"));
}

/**
 * Ensure login cert exists. If not, spawn `cloudflared tunnel login` interactively.
 */
function ensureLogin(bin) {
	if (existsSync(CERT_PATH)) return;
	console.log("");
	console.log("  ⚠ No Cloudflare cert found — opening browser for login.");
	console.log("  Select the zone (domain) you want this tunnel to use.");
	console.log("");
	runSync(bin, ["tunnel", "login"]);
}

/**
 * Find existing tunnel ID by name, or create one.
 */
function ensureTunnel(bin, name) {
	const list = spawnSync(bin, ["tunnel", "list", "--output", "json"], { encoding: "utf-8" });
	if (list.status === 0 && list.stdout) {
		try {
			const tunnels = JSON.parse(list.stdout);
			const found = tunnels.find((t) => t.name === name);
			if (found) {
				console.log(`  ✓ Tunnel "${name}" already exists (${found.id}).`);
				return found.id;
			}
		} catch {
			// Fall through to create.
		}
	}

	console.log(`  + Creating tunnel "${name}"...`);
	runSync(bin, ["tunnel", "create", name]);

	// Look up the newly created tunnel id from credentials file.
	if (existsSync(CF_DIR)) {
		const creds = readdirSync(CF_DIR).filter((f) => f.endsWith(".json"));
		if (creds.length > 0) {
			const latest = creds
				.map((f) => ({ f, t: existsSync(join(CF_DIR, f)) ? readFileSync(join(CF_DIR, f)) : null }))
				.filter((x) => x.t)
				.pop();
			if (latest) return latest.f.replace(".json", "");
		}
	}
	throw new Error("Could not resolve new tunnel ID after create.");
}

/**
 * Write ~/.cloudflared/<id>.yml config for permanent tunnel.
 */
function writeTunnelConfig(tunnelId, hostname, port) {
	const configPath = join(CF_DIR, `${tunnelId}.yml`);
	const credPath = join(CF_DIR, `${tunnelId}.json`);
	const yaml = [
		`tunnel: ${tunnelId}`,
		`credentials-file: ${credPath}`,
		"",
		"ingress:",
		`  - hostname: ${hostname}`,
		`    service: http://localhost:${port}`,
		"    originRequest:",
		`      httpHostHeader: localhost:${port}`,
		"  - service: http_status:404",
		"",
	].join("\n");
	mkdirSync(CF_DIR, { recursive: true });
	writeFileSync(configPath, yaml, "utf-8");
	console.log(`  + Wrote ${configPath}`);
	return configPath;
}

/**
 * Main entry.
 */
async function main() {
	const config = await loadConfig();
	const hostname = hostnameArg || config.hostname || "";
	const port = config.port;
	const bin = await resolveCloudflared();

	if (!hostname) {
		// Quick mode.
		console.log("");
		console.log("  ┌──────────────────────────────────────────────────────────┐");
		console.log("  │  Quick tunnel mode (temporary URL)                       │");
		console.log("  │                                                          │");
		console.log("  │  ⚠ The URL CHANGES on every start.                       │");
		console.log("  │  For a fixed URL, set tunnel.hostname in                 │");
		console.log("  │  wp-bridge.config.ts to a domain on Cloudflare.          │");
		console.log("  └──────────────────────────────────────────────────────────┘");
		console.log("");
		runForeground(bin, ["tunnel", "--url", `http://localhost:${port}`]);
		return;
	}

	// Permanent mode.
	console.log("");
	console.log(`  Permanent tunnel mode → ${hostname}`);
	console.log("");

	ensureLogin(bin);

	// Derive a stable tunnel name from hostname (e.g. wp.example.com → wp-example-com).
	const tunnelName = hostname.replace(/\./g, "-");
	const tunnelId = ensureTunnel(bin, tunnelName);

	// Ensure DNS route.
	console.log(`  + Routing DNS ${hostname} → tunnel ${tunnelName}`);
	const routeResult = spawnSync(bin, ["tunnel", "route", "dns", tunnelName, hostname], {
		stdio: "inherit",
	});
	if (routeResult.status !== 0) {
		console.log("  (DNS route may already exist — continuing.)");
	}

	const configPath = writeTunnelConfig(tunnelId, hostname, port);

	console.log("");
	console.log(`  → https://${hostname}`);
	console.log("");
	runForeground(bin, ["tunnel", "--config", configPath, "run", tunnelName]);
}

main().catch((err) => {
	console.error("  ✗", err.message);
	process.exit(1);
});
