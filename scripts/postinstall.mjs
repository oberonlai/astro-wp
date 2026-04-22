#!/usr/bin/env node

/**
 * Postinstall script for astro-wp-bridge.
 *
 * Copies WordPress Playground infrastructure files to the consuming
 * project after npm/pnpm/yarn install. Skips files that already exist
 * so it is safe to run multiple times.
 *
 * What it sets up:
 * - blueprint.json (Playground init config)
 * - wp-bridge.config.ts (REST API credentials)
 * - scripts/wp-setup.mjs (first-time setup)
 * - wordpress/plugins/astro-cms-connect/ (WordPress plugin)
 * - src/loaders/wordpress.ts + type declarations
 * - package.json scripts (wp:setup, wp:start, dev)
 * - .gitignore entries
 *
 * What still requires manual (or AI agent) work:
 * - src/content.config.ts — add wpPosts collection
 * - Page files — merge WordPress + local collections
 * - npm run wp:setup — generate Application Password
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

// Find the consuming project root via INIT_CWD (set by npm/pnpm/yarn during install).
const projectRoot = process.env.INIT_CWD || resolve(PKG_ROOT, "..", "..");

// Guard: do not run when installing astro-wp-bridge itself (development).
const projectPkg = resolve(projectRoot, "package.json");
if (existsSync(projectPkg)) {
	const pkg = JSON.parse(readFileSync(projectPkg, "utf-8"));
	if (pkg.name === "astro-wp-bridge") {
		process.exit(0);
	}
}

console.log("\n  [astro-wp-bridge] Setting up WordPress Playground...\n");

/**
 * Copy a single file if the destination does not exist.
 */
function copyIfMissing(src, dest, label) {
	if (existsSync(dest)) {
		console.log(`  ✓ ${label} (already exists)`);
		return false;
	}
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(src, dest);
	console.log(`  + ${label}`);
	return true;
}

/**
 * Recursively copy a directory if the destination does not exist.
 */
function copyDirIfMissing(src, dest, label) {
	if (existsSync(dest)) {
		console.log(`  ✓ ${label} (already exists)`);
		return false;
	}
	copyDirRecursive(src, dest);
	console.log(`  + ${label}`);
	return true;
}

function copyDirRecursive(src, dest) {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src)) {
		const srcPath = join(src, entry);
		const destPath = join(dest, entry);
		if (statSync(srcPath).isDirectory()) {
			copyDirRecursive(srcPath, destPath);
		} else {
			copyFileSync(srcPath, destPath);
		}
	}
}

// --- 1. Template files ---

copyIfMissing(
	resolve(PKG_ROOT, "templates/blueprint.json"),
	resolve(projectRoot, "blueprint.json"),
	"blueprint.json",
);

copyIfMissing(
	resolve(PKG_ROOT, "templates/wp-bridge.config.ts"),
	resolve(projectRoot, "wp-bridge.config.ts"),
	"wp-bridge.config.ts",
);

copyIfMissing(
	resolve(PKG_ROOT, "templates/scripts/wp-setup.mjs"),
	resolve(projectRoot, "scripts/wp-setup.mjs"),
	"scripts/wp-setup.mjs",
);

copyIfMissing(
	resolve(PKG_ROOT, "templates/scripts/wp-deploy.mjs"),
	resolve(projectRoot, "scripts/wp-deploy.mjs"),
	"scripts/wp-deploy.mjs",
);

// --- 2. WordPress plugin ---

copyDirIfMissing(
	resolve(PKG_ROOT, "packages/wordpress-plugin"),
	resolve(projectRoot, "wordpress/plugins/astro-cms-connect"),
	"wordpress/plugins/astro-cms-connect/",
);

// --- 3. Loader files ---

const loaderSrc = resolve(PKG_ROOT, "packages/core/loaders/wordpress.ts");
const loaderDest = resolve(projectRoot, "src/loaders/wordpress.ts");

if (!existsSync(loaderDest)) {
	mkdirSync(dirname(loaderDest), { recursive: true });
	// Fix import path: from packages/core/loaders/ (3 levels) to src/loaders/ (2 levels).
	let loaderContent = readFileSync(loaderSrc, "utf-8");
	loaderContent = loaderContent.replace(
		/from\s+["']\.\.\/\.\.\/\.\.\/wp-bridge\.config["']/,
		'from "../../wp-bridge.config"',
	);
	writeFileSync(loaderDest, loaderContent, "utf-8");
	console.log("  + src/loaders/wordpress.ts");
} else {
	console.log("  ✓ src/loaders/wordpress.ts (already exists)");
}

copyIfMissing(
	resolve(PKG_ROOT, "packages/core/loaders/turndown-plugin-gfm.d.ts"),
	resolve(projectRoot, "src/loaders/turndown-plugin-gfm.d.ts"),
	"src/loaders/turndown-plugin-gfm.d.ts",
);

// --- 3b. Integration file ---

const integrationSrc = resolve(PKG_ROOT, "packages/core/integrations/wp-dev-reload.ts");
const integrationDest = resolve(projectRoot, "src/integrations/wp-dev-reload.ts");

if (!existsSync(integrationDest)) {
	mkdirSync(dirname(integrationDest), { recursive: true });
	// Fix import path: from packages/core/integrations/ (3 levels) to src/integrations/ (2 levels).
	let integrationContent = readFileSync(integrationSrc, "utf-8");
	integrationContent = integrationContent.replace(
		/from\s+["']\.\.\/\.\.\/\.\.\/wp-bridge\.config["']/,
		'from "../../wp-bridge.config"',
	);
	writeFileSync(integrationDest, integrationContent, "utf-8");
	console.log("  + src/integrations/wp-dev-reload.ts");
} else {
	console.log("  ✓ src/integrations/wp-dev-reload.ts (already exists)");
}

// --- 4. Update package.json scripts ---

const pkgPath = resolve(projectRoot, "package.json");
if (existsSync(pkgPath)) {
	const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
	let changed = false;

	if (!pkg.scripts) pkg.scripts = {};

	if (!pkg.scripts["wp:setup"]) {
		pkg.scripts["wp:setup"] = "node scripts/wp-setup.mjs";
		changed = true;
	}

	if (!pkg.scripts["wp:deploy"]) {
		pkg.scripts["wp:deploy"] = "node scripts/wp-deploy.mjs";
		changed = true;
	}

	const isWindows = process.platform === "win32";

	const wpStartCmd = isWindows
		? 'npx @wp-playground/cli@latest server --mount-before-install-dir "./wordpress/site" "/wordpress" --mount-dir "./wordpress/plugins/astro-cms-connect" "/wordpress/wp-content/plugins/astro-cms-connect" --blueprint=blueprint.json --port=8888 2>&1 | findstr /V "Cannot unzip"'
		: "npx @wp-playground/cli@latest server --mount-before-install=./wordpress/site:/wordpress --mount=./wordpress/plugins/astro-cms-connect:/wordpress/wp-content/plugins/astro-cms-connect --blueprint=blueprint.json --port=8888 2>&1 | grep -v 'Cannot unzip'";

	if (!pkg.scripts["wp:start"]) {
		pkg.scripts["wp:start"] = wpStartCmd;
		changed = true;
	}

	// Update dev script only if it does not already contain wp-playground.
	if (pkg.scripts.dev && !pkg.scripts.dev.includes("wp-playground")) {
		const originalDev = pkg.scripts.dev;
		if (isWindows) {
			pkg.scripts.dev = `concurrently "npm run wp:start" "node -e \\"setTimeout(()=>{},10000)\\" && ${originalDev}"`;
		} else {
			pkg.scripts.dev = `${wpStartCmd} & sleep 10 && ${originalDev}`;
		}
		changed = true;
	}

	if (changed) {
		writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
		console.log("  + package.json scripts (wp:setup, wp:start, wp:deploy, dev)");
	} else {
		console.log("  ✓ package.json scripts (already configured)");
	}
}

// --- 5. Update .gitignore ---

const gitignorePath = resolve(projectRoot, ".gitignore");
const ignoreEntries = ["wordpress/site/", "src/config/wp-categories.json"];

if (existsSync(gitignorePath)) {
	let content = readFileSync(gitignorePath, "utf-8");
	let added = false;

	for (const entry of ignoreEntries) {
		if (!content.includes(entry)) {
			content += `\n${entry}`;
			added = true;
		}
	}

	if (added) {
		writeFileSync(gitignorePath, content.trimEnd() + "\n", "utf-8");
		console.log("  + .gitignore entries");
	} else {
		console.log("  ✓ .gitignore (already configured)");
	}
} else {
	writeFileSync(gitignorePath, ignoreEntries.join("\n") + "\n", "utf-8");
	console.log("  + .gitignore (created)");
}

// --- Done ---

console.log("");
console.log("  ┌──────────────────────────────────────────────────────┐");
console.log("  │  astro-wp-bridge installed successfully!             │");
console.log("  │                                                      │");
console.log("  │  Next steps:                                         │");
console.log("  │  1. Run: npm run wp:setup                            │");
console.log("  │  2. Add wpPosts collection to content.config.ts      │");
console.log("  │  3. Merge collections in your page files             │");
console.log("  │  4. Register wpDevReload() in astro.config.mjs       │");
console.log("  │  5. Add poll script to <head> (see README Step 7)    │");
console.log("  │  6. Run: npx wrangler login (Cloudflare deploy auth) │");
console.log("  │  7. Run: npm run dev                                 │");
console.log("  └──────────────────────────────────────────────────────┘");
console.log("");
