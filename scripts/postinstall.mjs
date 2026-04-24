#!/usr/bin/env node

/**
 * Postinstall script for astro-wp.
 *
 * Copies WordPress Playground infrastructure files to the consuming
 * project after npm/pnpm/yarn install. Skips files that already exist
 * so it is safe to run multiple times.
 *
 * What it sets up:
 * - blueprint.json (Playground init config)
 * - wp-bridge.config.ts (REST API credentials)
 * - scripts/wp-setup.mjs (first-time setup)
 * - scripts/wp-deploy.mjs (local deploy server)
 * - wordpress/plugins/astro-cms-connect/ (WordPress plugin)
 * - src/loaders/wordpress.ts + type declarations
 * - wrangler devDependency (for Cloudflare deploy)
 * - package.json scripts (wp:setup, wp:start, wp:deploy, dev)
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

// Guard: do not run when installing astro-wp itself (development).
const projectPkg = resolve(projectRoot, "package.json");
if (existsSync(projectPkg)) {
	const pkg = JSON.parse(readFileSync(projectPkg, "utf-8"));
	if (pkg.name === "astro-wp") {
		process.exit(0);
	}
}

console.log("\n  [astro-wp] Setting up WordPress Playground...\n");

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

copyIfMissing(
	resolve(PKG_ROOT, "templates/scripts/wp-tunnel.mjs"),
	resolve(projectRoot, "scripts/wp-tunnel.mjs"),
	"scripts/wp-tunnel.mjs",
);

// --- 1b. Pre-create required directories ---

const wpSiteDir = resolve(projectRoot, "wordpress/site");
if (!existsSync(wpSiteDir)) {
	mkdirSync(wpSiteDir, { recursive: true });
	console.log("  + wordpress/site/ (required by Playground CLI)");
} else {
	console.log("  ✓ wordpress/site/ (already exists)");
}

const wpCategoriesDir = resolve(projectRoot, "src/config");
if (!existsSync(wpCategoriesDir)) {
	mkdirSync(wpCategoriesDir, { recursive: true });
	console.log("  + src/config/ (for wp-categories.json)");
}

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

copyIfMissing(
	resolve(PKG_ROOT, "packages/core/loaders/wp-images.ts"),
	resolve(projectRoot, "src/loaders/wp-images.ts"),
	"src/loaders/wp-images.ts",
);

copyIfMissing(
	resolve(PKG_ROOT, "packages/core/loaders/wp-snapshot.ts"),
	resolve(projectRoot, "src/loaders/wp-snapshot.ts"),
	"src/loaders/wp-snapshot.ts",
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

// --- 4. Ensure all required dependencies are present ---

const pkgPath = resolve(projectRoot, "package.json");

/**
 * Add a dependency to the target project's package.json if missing.
 */
function ensureDep(pkgObj, name, version, dev) {
	const inDeps = pkgObj.dependencies && pkgObj.dependencies[name];
	const inDevDeps = pkgObj.devDependencies && pkgObj.devDependencies[name];

	if (inDeps || inDevDeps) {
		console.log(`  ✓ ${name} (already in dependencies)`);
		return false;
	}

	const target = dev ? "devDependencies" : "dependencies";
	if (!pkgObj[target]) pkgObj[target] = {};
	pkgObj[target][name] = version;
	console.log(`  + ${name} added to ${target}`);
	return true;
}

if (existsSync(pkgPath)) {
	const pkgCheck = JSON.parse(readFileSync(pkgPath, "utf-8"));
	let depsChanged = false;

	// Runtime dependencies (turndown and wrangler come from astro-wp's own deps,
	// but add them to the target project too for when astro-wp is uninstalled).
	depsChanged = ensureDep(pkgCheck, "turndown", "^7.2.4", false) || depsChanged;
	depsChanged = ensureDep(pkgCheck, "turndown-plugin-gfm", "^1.0.2", false) || depsChanged;
	depsChanged = ensureDep(pkgCheck, "cloudflared", "^0.7.0", false) || depsChanged;

	// Dev dependencies.
	depsChanged = ensureDep(pkgCheck, "@types/turndown", "^5.0.6", true) || depsChanged;

	if (depsChanged) {
		writeFileSync(pkgPath, JSON.stringify(pkgCheck, null, 2) + "\n", "utf-8");
	}
}

// --- 5. Update package.json scripts ---

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

	if (!pkg.scripts["wp:tunnel"]) {
		pkg.scripts["wp:tunnel"] = "node scripts/wp-tunnel.mjs";
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
			pkg.scripts.dev = `concurrently "npm run wp:start" "npm run wp:deploy" "node -e \\"setTimeout(()=>{},10000)\\" && ${originalDev}"`;
		} else {
			pkg.scripts.dev = `${wpStartCmd} & node scripts/wp-deploy.mjs & sleep 10 && ${originalDev}`;
		}
		changed = true;
	}

	if (changed) {
		writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
		console.log("  + package.json scripts (wp:setup, wp:start, wp:deploy, wp:tunnel, dev)");
	} else {
		console.log("  ✓ package.json scripts (already configured)");
	}
}

// --- 6. Update .gitignore ---

const gitignorePath = resolve(projectRoot, ".gitignore");
const ignoreEntries = [
	"wordpress/site/",
	"src/config/wp-categories.json",
	"public/wp-images/",
];

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

// --- 7. Install cross-agent skill into project-local conventions ---

const skillSrc = resolve(PKG_ROOT, "skills/cloudflare-tunnel/SKILL.md");

if (existsSync(skillSrc)) {
	// Claude Code (project-local).
	copyIfMissing(
		skillSrc,
		resolve(projectRoot, ".claude/skills/astro-wp-tunnel/SKILL.md"),
		".claude/skills/astro-wp-tunnel/SKILL.md",
	);

	// Cursor (rename extension to .mdc, content is compatible).
	const cursorPath = resolve(projectRoot, ".cursor/rules/astro-wp-tunnel.mdc");
	if (!existsSync(cursorPath)) {
		mkdirSync(dirname(cursorPath), { recursive: true });
		copyFileSync(skillSrc, cursorPath);
		console.log("  + .cursor/rules/astro-wp-tunnel.mdc");
	} else {
		console.log("  ✓ .cursor/rules/astro-wp-tunnel.mdc (already exists)");
	}

	// Codex / Antigravity / other AGENTS.md-aware agents.
	const agentsPath = resolve(projectRoot, "AGENTS.md");
	const agentsRef =
		"\n## astro-wp tunnel\n\nFor exposing the local WordPress to the internet via Cloudflare Tunnel, follow `.claude/skills/astro-wp-tunnel/SKILL.md`.\n";

	if (existsSync(agentsPath)) {
		const agentsContent = readFileSync(agentsPath, "utf-8");
		if (!agentsContent.includes("astro-wp-tunnel")) {
			writeFileSync(agentsPath, agentsContent.trimEnd() + "\n" + agentsRef, "utf-8");
			console.log("  + AGENTS.md (appended tunnel skill reference)");
		} else {
			console.log("  ✓ AGENTS.md (already references tunnel skill)");
		}
	} else {
		writeFileSync(agentsPath, "# Agent Instructions\n" + agentsRef, "utf-8");
		console.log("  + AGENTS.md (created with tunnel skill reference)");
	}
}

// --- Done ---

console.log("");
console.log("  ┌──────────────────────────────────────────────────────────┐");
console.log("  │  astro-wp installed successfully!                        │");
console.log("  │  (wrangler included — no extra install needed)           │");
console.log("  │                                                          │");
console.log("  │  Next steps:                                             │");
console.log("  │  1. Add wpPosts collection to content.config.ts          │");
console.log("  │  2. Merge collections in your page files                 │");
console.log("  │  3. Register wpDevReload() in astro.config.mjs           │");
console.log("  │  4. Add poll script to <head> (see README Step 6)        │");
console.log("  │  5. Run: npm run wp:setup                                │");
console.log("  │  6. Run: npm run dev                                     │");
console.log("  │                                                          │");
console.log("  │  Deploy (do last, requires user interaction):             │");
console.log("  │  1. Run: npx wrangler login (Cloudflare OAuth)           │");
console.log("  │  2. Run: npm run wp:deploy (local deploy server)         │");
console.log("  │                                                          │");
console.log("  │  Expose local WP to the internet (optional, do last):     │");
console.log("  │  - Run: npm run wp:tunnel                                │");
console.log("  │    (Set tunnel.hostname in wp-bridge.config.ts for a     │");
console.log("  │     fixed URL; empty = temporary trycloudflare URL.)     │");
console.log("  │                                                          │");
console.log("  │  Snapshot mode (for Cloudflare Git integration):         │");
console.log("  │  - wp:deploy auto-commits src/config/wp-snapshot/ and    │");
console.log("  │    public/wp-images/ so cloud builds can read them       │");
console.log("  │    without reaching localhost WordPress.                 │");
console.log("  └──────────────────────────────────────────────────────────┘");
console.log("");
