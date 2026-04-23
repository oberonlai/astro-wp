# Astro WP — Claude Code Instructions

Follow `README.md` for the complete installation guide.

## CRITICAL: Installation Method

**MUST use `npm install github:oberonlai/astro-wp` to install.** This triggers the postinstall script which automatically copies all files, adds dependencies, and configures scripts.

**NEVER manually copy files from this repo to the target project.** The postinstall handles everything:
- Bridge files (loaders, integrations, WordPress plugin, configs, scripts)
- Import path fixes
- Adding `turndown`, `wrangler`, `@types/turndown` to target project
- Adding `wp:setup`, `wp:start`, `wp:deploy` npm scripts
- Updating `.gitignore` and `dev` script

All dependencies (turndown, wrangler, etc.) are included — no additional install step needed.

## Key Points for Claude Code

- **Step 0 is critical**: Always analyze the target Astro project first before installing. Understand its content collections, category system, and page structure.
- Adapt all code to match the target project's naming conventions (e.g., if the project calls its collection `blog` instead of `news`, rename accordingly).
- The `wp-bridge.config.ts` import path in `wordpress.ts` must be adjusted based on where the loader file is placed.
- The `merged-categories.ts` import path for category config must match the target project's actual config file location and structure.
- After installation, run `npm run wp:setup` and verify with `npm run dev`.
- If the target project uses pnpm or yarn, use the corresponding package manager commands.
