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

## Image handling setup (run after installation)

The loader downloads WordPress images into `public/wp-images/` so they ship with the Astro build (no more dependency on the WP tunnel for images in production). Inline images work out of the box. Featured images require one small wiring step — do this after `npm install`:

1. Open the target project's `src/content.config.ts` (or `src/content/config.ts`).
2. Inspect each WordPress-backed collection's schema for an image-like field. Common names: `heroImage`, `featuredImage`, `cover`, `image`, `thumbnail`.
3. In `wp-bridge.config.ts`, set `images.featuredImageField` to the exact field name you found. Keep the matching alt-text field (`<field>Alt`) in the schema if the theme uses it.
4. If no such field exists but the user wants featured images, add one to the schema (e.g. `heroImage: z.string().optional()`, `heroImageAlt: z.string().optional()`) and set `featuredImageField` accordingly.
5. If the user does not want featured images at all, leave `featuredImageField: "auto"` (the loader will skip it).

The schema field naming is project-specific — always read the actual file, do not assume.
