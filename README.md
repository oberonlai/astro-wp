# Astro WP Bridge

Add WordPress as a headless CMS to any Astro site. WordPress Playground runs locally — no Docker, no MySQL, no PHP install needed. Content is fetched via REST API at build time.

## What This Does

```
Your Markdown files ──┐
                      ├──→ Astro build → Static site
WordPress CMS ────────┘
```

- Editors use WordPress to write and manage content
- You keep writing Markdown as usual
- Both sources merge into the same frontend at build time
- WordPress runs locally via Playground CLI (zero infrastructure)

## Prerequisites

- An existing Astro 5+ project with content collections
- Node.js 20+

## Installation (for AI Coding Agents)

> This project is designed to be installed by an AI coding agent (Claude Code, Cursor, Windsurf, Cline, etc.). Give your agent these instructions along with your Astro project.

### Step 0: Analyze the target Astro project

Before making any changes, read and understand the target project:

1. Read `src/content.config.ts` (or `src/content/config.ts`) — identify:
   - What content collections exist (e.g., `news`, `blog`, `posts`)
   - What schema fields each collection uses (title, date, category, etc.)
   - What loader is used (`glob`, `file`, etc.)

2. Read the category/taxonomy config — identify:
   - Where categories are defined (e.g., `src/config/category.json`)
   - What category IDs exist
   - How categories are used in pages

3. Read the listing pages (e.g., `src/pages/news/[...page].astro` or `src/pages/blog/[...page].astro`) — identify:
   - How content is queried (`getCollection`)
   - How pagination works
   - How category navigation is rendered

4. Read the single article page (e.g., `src/pages/news/[id].astro` or `src/pages/blog/[slug].astro`) — identify:
   - How `getStaticPaths` is structured
   - What components are used (related posts, navigation, etc.)
   - How the article body is rendered

5. Detect the package manager — check which lock file exists:
   - `pnpm-lock.yaml` → use `pnpm`
   - `yarn.lock` → use `yarn`
   - `bun.lockb` → use `bun`
   - `package-lock.json` or none → use `npm`
   - If multiple lock files exist, use the one matching the lock file that is git-tracked (check with `git ls-files`). Delete the other lock file silently.
   - **Do not ask the user which package manager to use.** Detect and proceed.

6. If the project has no category/taxonomy system, skip `merged-categories.ts` in Step 2 and skip Step 4's category-related changes.

This analysis determines how to adapt the installation to this specific project.

### Step 1: Install dependencies

Use the detected package manager from Step 0:

```bash
# npm
npm install turndown turndown-plugin-gfm
npm install -D @types/turndown

# pnpm
pnpm add turndown turndown-plugin-gfm
pnpm add -D @types/turndown

# yarn
yarn add turndown turndown-plugin-gfm
yarn add -D @types/turndown
```

### Step 2: Copy files to the target project

Copy from this repo to the target Astro project:

| Source (this repo) | Destination (target project) |
|--------|-------------|
| `packages/core/loaders/wordpress.ts` | `src/loaders/wordpress.ts` |
| `packages/core/loaders/turndown-plugin-gfm.d.ts` | `src/loaders/turndown-plugin-gfm.d.ts` |
| `packages/core/merged-categories.ts` | `src/utils/merged-categories.ts` |
| `packages/wordpress-plugin/` (entire directory) | `wordpress/plugins/astro-cms-connect/` |
| `templates/wp-bridge.config.ts` | `wp-bridge.config.ts` (project root) |
| `templates/blueprint.json` | `blueprint.json` (project root) |
| `templates/scripts/wp-setup.mjs` | `scripts/wp-setup.mjs` |

### Step 3: Adapt the loader to the project

In `src/loaders/wordpress.ts`, fix the import path to resolve `wp-bridge.config.ts` at the project root:

```ts
// If loader is at src/loaders/wordpress.ts (2 levels deep):
import wpBridgeConfig from "../../wp-bridge.config";
```

Adjust the relative path depth if the loader is placed elsewhere.

### Step 4: Adapt `merged-categories.ts` to the project

In `src/utils/merged-categories.ts`, update the import to match the project's category config file path and structure. The default assumes `@/config/category.json` with a `news` key.

If the project uses a different path or structure, adapt accordingly.

### Step 5: Add WordPress collection to content config

In the project's content config file, add:

```ts
import { wpLoader } from "@/loaders/wordpress";
```

Create a schema that matches the project's existing article schema but uses `z.string()` for category (since WordPress categories are dynamic):

```ts
const wpPostsSchema = z.object({
  title: z.string(),
  category: z.string(),
  pubDate: z.coerce.date(),
});

const wpPosts = defineCollection({
  loader: wpLoader(),
  schema: wpPostsSchema,
});
```

Add `wpPosts` to the collection exports.

### Step 6: Merge WordPress content into existing pages

This step requires adapting to the specific project's page structure.

**Listing page** (e.g., `[...page].astro`):

```ts
// Before: only local content
const allPosts = await getCollection("news");

// After: merge both sources
const [localPosts, wpPosts] = await Promise.all([
  getCollection("news"),
  getCollection("wpPosts"),
]);
const allPosts = [...localPosts, ...wpPosts];
```

**Category page** (e.g., `category/[category]/[...page].astro`):

Replace the static category list with merged categories:

```ts
// Before
import categoryData from "@/config/category.json";
// Use: categoryData.news

// After
import { newsCategories } from "@/utils/merged-categories";
// Use: newsCategories
```

Also merge both collections when filtering by category.

**Single article page** (e.g., `[id].astro` or `[slug].astro`):

Add the WordPress collection to `getStaticPaths`:

```ts
const [localPosts, wpPosts] = await Promise.all([
  getCollection("news"),
  getCollection("wpPosts"),
]);
return [...localPosts, ...wpPosts].map((post) => ({
  params: { id: post.id },
  props: { post },
}));
```

Handle optional fields that may only exist in one collection:

```ts
// sessionSlug may not exist in WordPress posts
const sessionSlug = "sessionSlug" in post.data ? post.data.sessionSlug : undefined;
```

### Step 7: Update .gitignore

Add these lines:

```
wordpress/site/
src/config/wp-categories.json
```

### Step 8: Update package.json scripts

Add these scripts (preserve existing scripts):

```json
{
  "wp:setup": "node scripts/wp-setup.mjs",
  "wp:start": "npx @wp-playground/cli@latest server --mount-before-install=./wordpress/site:/wordpress --mount=./wordpress/plugins/astro-cms-connect:/wordpress/wp-content/plugins/astro-cms-connect --blueprint=blueprint.json --port=8888"
}
```

Modify the `dev` script to start WordPress alongside Astro:

```json
{
  "dev": "npx @wp-playground/cli@latest server --mount-before-install=./wordpress/site:/wordpress --mount=./wordpress/plugins/astro-cms-connect:/wordpress/wp-content/plugins/astro-cms-connect --blueprint=blueprint.json --port=8888 & sleep 10 && astro dev"
}
```

### Step 9: First-time setup

```bash
npm run wp:setup
```

This automatically:
1. Starts WordPress Playground CLI
2. Installs and activates the astro-cms-connect plugin
3. Creates an Application Password
4. Writes the password to `wp-bridge.config.ts`

### Step 10: Verify

```bash
npm run dev
```

1. Open `http://localhost:8888/wp-admin` — WordPress admin (auto-login)
2. Create a post in WordPress
3. Restart Astro dev server — the post should appear on the frontend

## How It Works

### Content Flow

```
WordPress (localhost:8888)
    ↓ REST API (build time)
    ↓ HTML → Markdown conversion
    ↓ Frontmatter mapping
Astro content collection (wpPosts)
    ↓ Merged with local Markdown collection
Static pages
```

### HTML → Markdown Pipeline

WordPress Gutenberg HTML is converted to clean Markdown in 5 steps:
1. Remove Gutenberg block comments (`<!-- wp:paragraph -->`, etc.)
2. Remove empty paragraphs and inline styles
3. Convert HTML to Markdown (Turndown + GFM + custom rules for figures, code blocks, YouTube/Vimeo embeds)
4. Clean conversion artifacts (excess newlines, stray HTML comments)
5. Fix whitespace around headings, lists, code blocks

### Category Sync

WordPress categories are fetched at build time and written to `src/config/wp-categories.json`. The `merged-categories.ts` utility merges them with the project's local categories. Local categories take priority on duplicates (same ID).

WordPress category slugs should match existing category IDs for proper grouping. New categories created only in WordPress will automatically appear in navigation after the next build.

### WordPress Plugin (astro-cms-connect)

A lightweight (~400 lines) WordPress plugin that provides:

- **Webhook on publish**: HMAC-SHA256 signed POST request when content changes (for triggering CI/CD rebuilds). 2-second debounce, non-blocking.
- **Health endpoint**: `GET /wp-json/astro-cms-connect/v1/health`
- **Settings page**: Settings > Astro CMS Connect — enable/disable, Astro URL, Webhook URL, auto-generated secret

### WordPress Playground

WordPress runs locally via `@wp-playground/cli` — a WebAssembly-based WordPress that uses SQLite instead of MySQL. No Docker, no PHP, no MySQL installation required. Just Node.js.

Data persists in `wordpress/site/` within the project directory. This directory is gitignored.

## Limitations

- WordPress Playground uses SQLite — some MySQL-specific plugins may not work (core WordPress and common plugins like Yoast/ACF are fine)
- Content is fetched at build time, not in real-time. Restart `npm run dev` or rebuild to see new WordPress posts
- For production deployment, you need WordPress accessible from the CI/CD environment (not just localhost)

## License

MIT
