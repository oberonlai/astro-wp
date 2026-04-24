# Astro WP

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

> **⚠️ IMPORTANT: Always install via `npm install github:oberonlai/astro-wp` (Step 1). Do NOT manually copy files from this repo. The postinstall script handles all file copying, dependency injection, and configuration automatically.**

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

7. Detect the operating system and adapt accordingly:
   - **macOS / Linux**: use shell commands as-is
   - **Windows**: apply these adjustments throughout the installation:
     - `dev` script: replace `cmd1 & sleep 10 && cmd2` with `concurrently` (install `concurrently` as devDependency)
     - `--mount=` flag: replace with `--mount-dir` flag (Windows-friendly format)
     - `wp-setup.mjs`: the script already uses `shell: true` in spawn, which handles `.cmd` extensions on Windows
   - **Do not ask the user which OS they are on.** Use `process.platform` or check the shell environment.

This analysis determines how to adapt the installation to this specific project.

### Step 1: Install astro-wp

Use the detected package manager from Step 0. Install from the GitHub repo:

```bash
# npm
npm install github:oberonlai/astro-wp

# pnpm
pnpm add github:oberonlai/astro-wp

# yarn
yarn add github:oberonlai/astro-wp
```

This single command:
- Installs `astro-wp` and all dependencies (`turndown`, `turndown-plugin-gfm`, `wrangler`)
- Runs the postinstall script which automatically:
  - Copies all bridge files (loaders, integrations, WordPress plugin, config templates, setup/deploy scripts)
  - Fixes import paths (`../../../` → `../../`)
  - Adds `@types/turndown` to the project's devDependencies
  - Adds `wp:setup`, `wp:start`, `wp:deploy` scripts to package.json
  - Modifies `dev` script to start WordPress alongside Astro
  - Updates `.gitignore`

No additional install step needed — all dependencies are included.

### Step 2: Adapt the loader to the project

Verify that the import path in `src/loaders/wordpress.ts` correctly resolves `wp-bridge.config.ts` at the project root. The postinstall sets it to `../../wp-bridge.config` (2 levels deep from `src/loaders/`).

If the loader is placed elsewhere, adjust the relative path accordingly.

### Step 3: Adapt `merged-categories.ts` to the project

In `src/utils/merged-categories.ts`, update the import to match the project's category config file path and structure. The default assumes `@/config/category.json` with a `news` key.

If the project uses a different path or structure, adapt accordingly.

### Step 4: Add WordPress collection to content config

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

### Step 5: Merge WordPress content into existing pages

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

### Step 6: Enable dev auto-reload

Register the `wpDevReload` integration in `astro.config.mjs` and inject a poll script into the page head.

**astro.config.mjs:**

```ts
import { wpDevReload } from './src/integrations/wp-dev-reload';

export default defineConfig({
  integrations: [mdx(), sitemap(), wpDevReload()],
});
```

In `src/integrations/wp-dev-reload.ts`, fix the import path to resolve `wp-bridge.config.ts` at the project root:

```ts
// If integration is at src/integrations/wp-dev-reload.ts (2 levels deep):
import wpBridgeConfig from "../../wp-bridge.config";
```

**BaseHead or layout `<head>`:**

Add the following inside the `<head>` tag of the project's base layout or head component. This only runs during dev:

```astro
{import.meta.env.DEV && (
  <script is:inline>
    (() => {
      const tick = () => fetch('/_wp_check').catch(() => {});
      tick();
      setInterval(tick, 3000);
    })();
  </script>
)}
```

This polls the dev server every 3 seconds. When a WordPress post is saved, the page auto-reloads with the updated content.

### Step 7: Verify auto-configured files

Step 1's postinstall already handled `.gitignore`, `package.json` scripts (`wp:setup`, `wp:start`, `wp:deploy`, `dev`), and `wrangler` devDependency. Verify they are present:

```bash
# Should show wp:setup, wp:start, wp:deploy, dev
grep -E "wp:(setup|start|deploy)|\"dev\"" package.json

# Should include wordpress/site/ and wp-categories.json
cat .gitignore | grep -E "wordpress|wp-categories"
```

If any are missing, re-run: `npm install github:oberonlai/astro-wp`

### Step 8: First-time setup

```bash
npm run wp:setup
```

This automatically:
1. Starts WordPress Playground CLI
2. Installs and activates the astro-cms-connect plugin
3. Creates an Application Password
4. Writes the password to `wp-bridge.config.ts`

### Step 9: Verify

```bash
npm run dev
```

1. Open `http://127.0.0.1:8888/wp-admin` — WordPress admin (auto-login)
2. Create a post in WordPress
3. The post should appear on the frontend within a few seconds (auto-reload)

### Step 10: Cloudflare deploy auth (optional, do last)

```bash
npx wrangler login
```

This opens a browser for Cloudflare OAuth. Only needs to be done once per machine. Required for `npm run wp:deploy` to work. **This step is interactive and requires the user to complete manually — do not block the rest of the installation on this step.**

### Step 11: Expose local WordPress to the internet (optional, do last)

If editors, clients, or external build pipelines need to reach the local WordPress, expose it via Cloudflare Tunnel.

```bash
npm run wp:tunnel
```

Two modes (auto-selected based on `wp-bridge.config.ts`):

- **Temporary URL** — leave `tunnel.hostname` empty. Prints a `xxx.trycloudflare.com` URL that **changes every start**. Zero setup.
- **Permanent URL** — set `tunnel.hostname` to a subdomain on a domain you own in Cloudflare (e.g. `"wp.example.com"`). First run prompts for `cloudflared tunnel login` (browser OAuth), then the script auto-creates the tunnel, DNS record, and config file.

Cross-platform: uses the npm `cloudflared` package which bundles the binary for macOS / Windows / Linux — no manual install needed.

**This step is interactive on first run (browser login). Do not block the rest of the installation on it.**

## Snapshot Mode (Git-based Cloud Deploy)

When the Cloudflare Git integration rebuilds your site, its build server cannot reach `localhost:8888` — it would produce a site with empty WordPress content and overwrite anything deployed via `wp:deploy`.

Snapshot mode solves this: the loader writes fully processed posts (Markdown converted, image URLs already rewritten) to `src/config/wp-snapshot/` during every live fetch, and reads from that directory when live WordPress isn't available.

### How it works

```
npm run dev                → live fetch → snapshot written → dev uses live
npm run build (local)      → live fetch → snapshot written → build uses live
wp-deploy webhook triggers → astro build → snapshot written → git commit + push → wrangler deploy
Cloudflare Git build       → no WP access → reads snapshot from repo ✓
```

### Snapshot layout

```
src/config/wp-snapshot/
├── index.json           # id → { slug, modified } + categories
└── posts/
    ├── 1.json           # fully processed post (data + body)
    └── 42.json
```

One file per post keeps git diffs readable and incremental. File size averages 5–15 KB per post. A 1000-post site stays around 10 MB in git.

### Loader priority

```
dev mode (npm run dev)          → live fetch
WP_LIVE=true env var            → live fetch (manual override)
snapshot exists + not dev       → read snapshot
no snapshot yet                 → fall back to live fetch
```

### Auto commit & push

`wp:deploy` after each successful build:

1. `git add src/config/wp-snapshot/ public/wp-images/`
2. Commits with message `content(wp): 同步 N 篇文章快照`
3. Pushes to remote — triggers Cloudflare Git rebuild
4. Runs `wrangler deploy` locally too for fast preview

Push failures (network, conflict) are logged and retried on the next webhook — non-fatal.

### Disabling snapshot

Set `snapshot.enabled: false` in `wp-bridge.config.ts`. The loader reverts to live-only behavior (original mode).

### Bootstrap

The first `wp:deploy` (or `npm run dev` with WP running) auto-creates the snapshot. No manual command required.

## Cross-Agent Skill

The Cloudflare Tunnel setup is packaged as a reusable skill. It tells any AI agent how to ask the user about their domain choice and drive `npm run wp:tunnel` correctly.

### Automatic installation

`npm install github:oberonlai/astro-wp` writes the skill into the target project automatically. No manual copy needed:

| Path | Agent |
|---|---|
| `.claude/skills/astro-wp-tunnel/SKILL.md` | Claude Code (project-local) |
| `.cursor/rules/astro-wp-tunnel.mdc` | Cursor |
| `AGENTS.md` (reference entry appended) | Codex CLI, Antigravity, any AGENTS.md-aware agent |

The AI agent picks it up on the next conversation in this project — no config required.

### When the skill triggers

The skill's frontmatter declares triggers like:

- 本地 WordPress 要讓別人看到
- 要把 localhost:8888 曝露到外網
- 建立 Cloudflare Tunnel

When the user asks any of these, the agent should follow the skill's flow: ask about the domain, update `wp-bridge.config.ts`, run `npm run wp:tunnel`, and warn about the temp URL caveat if applicable.

### Installing globally (optional)

If you want the skill available in every project without re-install:

```bash
# Claude Code global
mkdir -p ~/.claude/skills/astro-wp-tunnel \
  && cp node_modules/astro-wp/skills/cloudflare-tunnel/SKILL.md ~/.claude/skills/astro-wp-tunnel/SKILL.md
```

## How It Works

### Content Flow

```
WordPress (127.0.0.1:8888)
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

### Deploy Flow (Save → Build → Deploy)

When WordPress is local, the Cloudflare build server cannot reach `localhost`. Instead, the build runs locally and uploads to Cloudflare:

```
WP saves post → webhook POST to localhost:4000
→ local astro build (fetches from localhost WP ✅)
→ npx wrangler deploy (uploads to Cloudflare Workers ✅)
```

Run alongside `npm run dev`:

```bash
npm run wp:deploy
```

The deploy server:
- Listens on `http://localhost:4000/webhook`
- Verifies HMAC signature from WordPress plugin
- Debounces rapid saves (5 second window)
- Queues deploys when a build is already running

The WordPress plugin (`astro-cms-connect`) is pre-configured to POST to `http://localhost:4000/webhook` on activation. Verify in WP admin: **Settings > Astro CMS Connect**.

### WordPress Playground

WordPress runs locally via `@wp-playground/cli` — a WebAssembly-based WordPress that uses SQLite instead of MySQL. No Docker, no PHP, no MySQL installation required. Just Node.js.

Data persists in `wordpress/site/` within the project directory. This directory is gitignored.

## Limitations

- WordPress Playground uses SQLite — some MySQL-specific plugins may not work (core WordPress and common plugins like Yoast/ACF are fine)
- Content is fetched at build time, not in real-time. Restart `npm run dev` or rebuild to see new WordPress posts
- Production deploy requires `npm run wp:deploy` running locally (builds locally, uploads to Cloudflare)

## License

MIT
