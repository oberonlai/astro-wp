import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

/**
 * Image handling configuration (from wp-bridge.config.ts `images` block).
 */
export interface ImageConfig {
	featuredImageField: string; // "auto" = skip featured image; otherwise the schema field name.
	downloadDir: string; // Relative to project root, e.g. "public/wp-images".
	publicPath: string; // URL prefix served at runtime, e.g. "/wp-images".
	cacheStrategy: "hash" | "always-refresh" | "skip-existing";
}

const DEFAULTS: ImageConfig = {
	featuredImageField: "auto",
	downloadDir: "public/wp-images",
	publicPath: "/wp-images",
	cacheStrategy: "hash",
};

export function resolveImageConfig(user?: Partial<ImageConfig>): ImageConfig {
	return { ...DEFAULTS, ...(user || {}) };
}

/**
 * Derive a stable, filesystem-safe filename from an image URL.
 * Embeds a short hash of the full URL so distinct sources don't collide
 * and WordPress-side URL changes trigger a fresh download.
 */
function urlToFilename(url: string): string {
	const clean = url.split("?")[0].split("#")[0];
	const rawBase = basename(clean) || "image";
	const ext = (extname(rawBase) || ".jpg").toLowerCase();
	const stem = rawBase.slice(0, rawBase.length - extname(rawBase).length) || "image";
	const safeStem = stem.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "image";
	const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
	return `${safeStem}-${hash}${ext}`;
}

export interface ImageDownloader {
	/**
	 * Download `url` if needed and return its public path.
	 * On failure, returns the original URL so content still renders.
	 */
	process(url: string): Promise<string>;
}

/**
 * Build an image downloader bound to a project root and a fetcher
 * (the fetcher is injected so we can reuse the loader's auth/cookie logic).
 */
export function createImageDownloader(
	projectRoot: string,
	config: ImageConfig,
	fetcher: (url: string) => Promise<Response>,
): ImageDownloader {
	const dir = resolve(projectRoot, config.downloadDir);
	const cache = new Map<string, string>();

	return {
		async process(url: string): Promise<string> {
			if (!url || !/^https?:\/\//i.test(url)) return url;

			const cached = cache.get(url);
			if (cached) return cached;

			const filename = urlToFilename(url);
			const localPath = resolve(dir, filename);
			const publicUrl = `${config.publicPath}/${filename}`;

			const shouldDownload =
				config.cacheStrategy === "always-refresh" || !existsSync(localPath);

			if (shouldDownload) {
				try {
					mkdirSync(dir, { recursive: true });
					const response = await fetcher(url);
					if (!response.ok) {
						cache.set(url, url);
						return url;
					}
					const buf = Buffer.from(await response.arrayBuffer());
					writeFileSync(localPath, buf);
				} catch {
					cache.set(url, url);
					return url;
				}
			}

			cache.set(url, publicUrl);
			return publicUrl;
		},
	};
}

/**
 * Scan HTML for <img src="..."> occurrences, download each image, and
 * rewrite the src to point at the local public path. Runs before Turndown
 * so the resulting Markdown carries local URLs.
 */
export async function rewriteImageUrls(
	html: string,
	downloader: ImageDownloader,
): Promise<string> {
	const imgRegex = /<img\b[^>]*?\ssrc=(["'])(.*?)\1[^>]*>/gi;
	const urls = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = imgRegex.exec(html)) !== null) {
		urls.add(match[2]);
	}

	const urlMap = new Map<string, string>();
	await Promise.all(
		[...urls].map(async (url) => {
			urlMap.set(url, await downloader.process(url));
		}),
	);

	return html.replace(imgRegex, (full, quote, url) => {
		const local = urlMap.get(url);
		if (!local || local === url) return full;
		return full.replace(`${quote}${url}${quote}`, `${quote}${local}${quote}`);
	});
}
