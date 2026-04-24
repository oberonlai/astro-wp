import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import type { Loader } from "astro/loaders";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
// This import path will be resolved relative to the user's project root.
// When installed, wp-bridge.config.ts lives at the project root.
import wpBridgeConfig from "../../../wp-bridge.config";
import {
	createImageDownloader,
	type ImageConfig,
	type ImageDownloader,
	resolveImageConfig,
	rewriteImageUrls,
} from "./wp-images";
import {
	hasSnapshot,
	readSnapshot,
	resolveSnapshotDir,
	type SnapshotCategory,
	type SnapshotEntry,
	writeSnapshot,
} from "./wp-snapshot";

/**
 * WordPress REST API post shape (relevant fields only).
 */
interface WPPost {
	id: number;
	slug: string;
	date: string;
	modified: string;
	featured_media?: number;
	title: { rendered: string };
	content: { rendered: string };
	excerpt: { rendered: string };
	categories: number[];
	_embedded?: {
		"wp:term"?: Array<Array<{ slug: string; taxonomy: string }>>;
		"wp:featuredmedia"?: Array<{
			source_url?: string;
			alt_text?: string;
		}>;
	};
}

/**
 * WordPress REST API category shape.
 */
interface WPCategory {
	id: number;
	slug: string;
	name: string;
}

/**
 * Decode HTML entities (e.g. &#8217; → ', &amp; → &).
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&apos;/g, "'");
}

/**
 * Build a Turndown instance with WordPress-specific rules.
 */
function createTurndown(): TurndownService {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});

	turndown.use(gfm);

	// WordPress caption blocks → image + italic caption.
	turndown.addRule("wpCaption", {
		filter: (node) => {
			return (
				node.nodeName === "FIGURE" &&
				node.querySelector("figcaption") !== null
			);
		},
		replacement: (_content, node) => {
			const el = node as HTMLElement;
			const img = el.querySelector("img");
			const caption = el.querySelector("figcaption");
			if (!img) return _content;
			const alt = img.getAttribute("alt") || "";
			const src = img.getAttribute("src") || "";
			const captionText = caption ? caption.textContent || "" : "";
			let result = `![${alt}](${src})`;
			if (captionText.trim()) {
				result += `\n*${captionText.trim()}*`;
			}
			return `\n\n${result}\n\n`;
		},
	});

	// WordPress code blocks — detect language from class.
	turndown.addRule("wpCodeBlock", {
		filter: (node) => {
			return (
				node.nodeName === "PRE" &&
				(node.classList.contains("wp-block-code") ||
					node.querySelector("code") !== null)
			);
		},
		replacement: (_content, node) => {
			const el = node as HTMLElement;
			const code = el.querySelector("code") || el;
			const className = code.className || "";
			const langMatch = className.match(/language-(\w+)/);
			const lang = langMatch ? langMatch[1] : "";
			const text = code.textContent || "";
			return `\n\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n\n`;
		},
	});

	// YouTube/Vimeo iframes → embedded players (raw HTML preserved through Markdown).
	turndown.addRule("iframe", {
		filter: "iframe",
		replacement: (_content, node) => {
			const el = node as HTMLElement;
			const src = el.getAttribute("src") || "";
			const youtubeMatch = src.match(
				/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
			);
			if (youtubeMatch) {
				return `\n\n<iframe width="560" height="315" src="https://www.youtube.com/embed/${youtubeMatch[1]}" frameborder="0" allowfullscreen></iframe>\n\n`;
			}
			const vimeoMatch = src.match(/player\.vimeo\.com\/video\/(\d+)/);
			if (vimeoMatch) {
				return `\n\n<iframe width="560" height="315" src="https://player.vimeo.com/video/${vimeoMatch[1]}" frameborder="0" allowfullscreen></iframe>\n\n`;
			}
			return "";
		},
	});

	return turndown;
}

/**
 * Convert WordPress HTML content to clean Markdown.
 *
 * Pipeline:
 * 1. Remove Gutenberg block comments.
 * 2. Remove empty paragraphs and inline styles.
 * 3. Convert HTML to Markdown via Turndown.
 * 4. Clean up artifacts (excess newlines, stray comments).
 * 5. Fix whitespace around headings, lists, code blocks.
 */
async function htmlToMarkdown(
	html: string,
	downloader?: ImageDownloader,
): Promise<string> {
	if (!html || !html.trim()) return "";

	const turndown = createTurndown();

	// Step 1: Remove Gutenberg block comments.
	let cleaned = html.replace(/<!--\s*\/?wp:\S+.*?-->/gs, "");

	// Step 2: Remove empty paragraphs and inline styles.
	cleaned = cleaned.replace(/<p>\s*<\/p>/g, "");
	cleaned = cleaned.replace(/\s*style="[^"]*"/g, "");

	// Step 2b: Download images and rewrite src to local public paths.
	if (downloader) {
		cleaned = await rewriteImageUrls(cleaned, downloader);
	}

	// Step 3: Convert to Markdown.
	let md = turndown.turndown(cleaned);

	// Step 4: Clean artifacts.
	md = md.replace(/<!--.*?-->/gs, "");
	md = md.replace(/\n{3,}/g, "\n\n");

	// Step 5: Ensure blank lines around headings.
	md = md.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
	md = md.replace(/(#{1,6}\s.+)\n([^\n])/g, "$1\n\n$2");

	return md.trim();
}

/**
 * Fetch with auto-login redirect handling for WordPress Playground.
 *
 * Playground's first request returns a 302 with Set-Cookie for auto-login.
 * We handle this by manually following the redirect with cookies attached.
 */
let _cachedCookies = "";

async function wpFetch(
	url: string,
	credentials: string,
): Promise<Response> {
	const maxRedirects = 5;
	let currentUrl = url;

	for (let i = 0; i <= maxRedirects; i++) {
		const headers: Record<string, string> = {
			Authorization: `Basic ${credentials}`,
		};
		if (_cachedCookies) {
			headers["Cookie"] = _cachedCookies;
		}

		const response = await fetch(currentUrl, {
			headers,
			redirect: "manual",
		});

		// Handle Playground auto-login redirect chain.
		if (response.status >= 300 && response.status < 400) {
			const setCookies = response.headers.getSetCookie
				? response.headers.getSetCookie()
				: [];
			if (setCookies.length > 0) {
				_cachedCookies = setCookies
					.map((c) => c.split(";")[0])
					.join("; ");
			}

			const location = response.headers.get("location") || "";
			if (!location) return response;

			currentUrl = location.startsWith("http")
				? location
				: new URL(location, currentUrl).href;
			continue;
		}

		return response;
	}

	// Exceeded max redirects — return the last response as-is.
	const headers: Record<string, string> = {
		Authorization: `Basic ${credentials}`,
	};
	if (_cachedCookies) {
		headers["Cookie"] = _cachedCookies;
	}
	return fetch(currentUrl, { headers, redirect: "manual" });
}

/**
 * Fetch all posts from WordPress REST API with pagination.
 */
async function fetchAllPosts(
	baseUrl: string,
	auth: { username: string; password: string },
	postType: string,
): Promise<WPPost[]> {
	const allPosts: WPPost[] = [];
	let page = 1;
	const perPage = 100;
	const credentials = btoa(`${auth.username}:${auth.password}`);

	const endpoint =
		postType === "post" ? "posts" : postType === "page" ? "pages" : postType;

	while (true) {
		const url = `${baseUrl}/wp-json/wp/v2/${endpoint}?per_page=${perPage}&page=${page}&_embed=wp:term,wp:featuredmedia&status=publish`;

		const response = await wpFetch(url, credentials);

		if (!response.ok) {
			if (response.status === 400 && page > 1) {
				// Past last page.
				break;
			}
			throw new Error(
				`WordPress API error: ${response.status} ${response.statusText}`,
			);
		}

		const posts = (await response.json()) as WPPost[];
		if (posts.length === 0) break;

		allPosts.push(...posts);

		const totalPages = Number(response.headers.get("X-WP-TotalPages")) || 1;
		if (page >= totalPages) break;
		page++;
	}

	return allPosts;
}

/**
 * Fetch all categories from WordPress.
 * Returns both a map of id → slug (for post resolution) and the full list.
 */
async function fetchCategories(
	baseUrl: string,
	auth: { username: string; password: string },
): Promise<{ map: Map<number, string>; list: WPCategory[] }> {
	const map = new Map<number, string>();
	const list: WPCategory[] = [];
	let page = 1;
	const credentials = btoa(`${auth.username}:${auth.password}`);

	while (true) {
		const url = `${baseUrl}/wp-json/wp/v2/categories?per_page=100&page=${page}`;
		const response = await wpFetch(url, credentials);

		if (!response.ok) break;

		const categories = (await response.json()) as WPCategory[];
		if (categories.length === 0) break;

		for (const cat of categories) {
			map.set(cat.id, cat.slug);
			list.push(cat);
		}

		const totalPages = Number(response.headers.get("X-WP-TotalPages")) || 1;
		if (page >= totalPages) break;
		page++;
	}

	return { map, list };
}

/**
 * Write WordPress categories to a JSON file for Astro pages to merge.
 */
function writeCategoryFile(categories: SnapshotCategory[]): void {
	const outputPath = resolve(
		import.meta.dirname || ".",
		"../config/wp-categories.json",
	);

	writeFileSync(
		outputPath,
		JSON.stringify({ news: categories }, null, 2) + "\n",
		"utf-8",
	);
}

/**
 * Convert fetched WordPress categories into snapshot category format,
 * filtering out the default "uncategorized" bucket.
 */
function toSnapshotCategories(categories: WPCategory[]): SnapshotCategory[] {
	return categories
		.filter((c) => c.slug !== "uncategorized")
		.map((c) => ({ id: c.slug, title: c.name }));
}

/**
 * Get the first matching category slug from a WordPress post.
 * Falls back to the first embedded term slug if category map lookup fails.
 */
function resolveCategory(
	post: WPPost,
	categoryMap: Map<number, string>,
): string {
	// Try category map first.
	for (const catId of post.categories) {
		const slug = categoryMap.get(catId);
		if (slug) return slug;
	}

	// Fallback to embedded terms.
	const terms = post._embedded?.["wp:term"];
	if (terms) {
		for (const group of terms) {
			for (const term of group) {
				if (term.taxonomy === "category" && term.slug !== "uncategorized") {
					return term.slug;
				}
			}
		}
	}

	return "uncategorized";
}

/**
 * Astro content loader that fetches posts from WordPress REST API.
 *
 * Usage in content.config.ts:
 *   import { wpLoader } from "@/loaders/wordpress";
 *   const wpNews = defineCollection({
 *     loader: wpLoader(),
 *     schema: newsSchema,
 *   });
 */
export function wpLoader(): Loader {
	const config = wpBridgeConfig;

	return {
		name: "wordpress-loader",
		async load({ store, logger }) {
			const { url, auth } = config.wordpress;

			// Snapshot mode: read from disk when enabled and snapshot exists.
			// Skipped in dev (always want live), or when WP_LIVE is explicitly set.
			const snapshotCfg = (config as { snapshot?: { enabled?: boolean; dir?: string } })
				.snapshot;
			const snapshotDir = resolveSnapshotDir(process.cwd(), snapshotCfg?.dir);
			const snapshotEnabled = snapshotCfg?.enabled !== false;
			const preferLive = process.env.WP_LIVE === "true" || import.meta.env?.DEV;

			if (snapshotEnabled && !preferLive && hasSnapshot(snapshotDir)) {
				logger.info(`Loading posts from snapshot: ${snapshotDir}`);
				const { posts, categories } = readSnapshot(snapshotDir);
				writeCategoryFile(categories);
				const processor = await createMarkdownProcessor({});
				for (const entry of posts) {
					const rendered = await processor.render(entry.body);
					store.set({
						id: entry.slug,
						data: entry.data,
						body: entry.body,
						rendered: {
							html: rendered.code,
							metadata: rendered.metadata as Record<string, unknown>,
						},
					});
				}
				logger.info(`Loaded ${posts.length} posts from snapshot.`);
				return;
			}

			if (!auth.password) {
				logger.warn(
					"WordPress Application Password not set in wp-bridge.config.ts — skipping WordPress content.",
				);
				return;
			}

			logger.info(`Fetching posts from ${url}...`);

			try {
				const postType = config.collections.posts.postType;
				const [posts, categories] = await Promise.all([
					fetchAllPosts(url, auth, postType),
					fetchCategories(url, auth),
				]);

				logger.info(`Fetched ${posts.length} posts from WordPress.`);

				// Write WordPress categories to JSON for Astro pages to merge.
				const snapshotCategories = toSnapshotCategories(categories.list);
				writeCategoryFile(snapshotCategories);
				logger.info(
					`Synced ${snapshotCategories.length} categories from WordPress.`,
				);

				// Set up image downloader. Images are pulled into the project's
				// public directory so they ship with the Astro build.
				const imageConfig = resolveImageConfig(
					(config as { images?: Partial<ImageConfig> }).images,
				);
				const credentials = btoa(`${auth.username}:${auth.password}`);
				const downloader = createImageDownloader(
					process.cwd(),
					imageConfig,
					(imageUrl) => wpFetch(imageUrl, credentials),
				);

				const processor = await createMarkdownProcessor({});
				const snapshotEntries: SnapshotEntry[] = [];

				for (const post of posts) {
					const category = resolveCategory(post, categories.map);
					const body = await htmlToMarkdown(post.content.rendered, downloader);
					const rendered = await processor.render(body);

					const data: Record<string, unknown> = {
						title: decodeHtmlEntities(post.title.rendered),
						category,
						pubDate: new Date(post.date),
					};

					// Featured image: only write when user explicitly configured a field name.
					if (imageConfig.featuredImageField !== "auto") {
						const media = post._embedded?.["wp:featuredmedia"]?.[0];
						const featuredUrl = media?.source_url;
						if (featuredUrl) {
							const localPath = await downloader.process(featuredUrl);
							data[imageConfig.featuredImageField] = localPath;
							if (media?.alt_text) {
								data[`${imageConfig.featuredImageField}Alt`] = media.alt_text;
							}
						}
					}

					store.set({
						id: post.slug,
						data,
						body,
						rendered: {
							html: rendered.code,
							metadata: rendered.metadata as Record<string, unknown>,
						},
					});

					snapshotEntries.push({
						id: post.id,
						slug: post.slug,
						modified: post.modified,
						data,
						body,
					});
				}

				// Persist snapshot so cloud builds (which can't reach localhost WP)
				// can still produce the site from the committed files.
				if (snapshotEnabled) {
					const result = writeSnapshot(
						snapshotDir,
						snapshotEntries,
						snapshotCategories,
						url,
					);
					logger.info(
						`Snapshot updated: ${result.written} written, ${result.removed} removed (${snapshotDir}).`,
					);
				}

				const displayPassword =
					(auth as { loginPassword?: string }).loginPassword || "password";
				console.log("");
				console.log("  ┌─────────────────────────────────────────────────┐");
				console.log(`  │  WP Admin   ${url}/wp-admin`.padEnd(51) + "│");
				console.log(`  │  Username   admin`.padEnd(51) + "│");
				console.log(`  │  Password   ${displayPassword}`.padEnd(51) + "│");
				console.log("  └─────────────────────────────────────────────────┘");
				console.log("");
			} catch (error) {
				logger.error(
					`Failed to fetch WordPress content: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	};
}
