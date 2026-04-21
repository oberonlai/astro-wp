# Astro WP Bridge — Claude Code Instructions

Follow `README.md` for the complete installation guide.

## Key Points for Claude Code

- **Step 0 is critical**: Always analyze the target Astro project first before copying any files. Understand its content collections, category system, and page structure.
- Adapt all code to match the target project's naming conventions (e.g., if the project calls its collection `blog` instead of `news`, rename accordingly).
- The `wp-bridge.config.ts` import path in `wordpress.ts` must be adjusted based on where the loader file is placed.
- The `merged-categories.ts` import path for category config must match the target project's actual config file location and structure.
- After installation, run `npm run wp:setup` and verify with `npm run dev`.
- If the target project uses pnpm or yarn, use the corresponding package manager commands.
