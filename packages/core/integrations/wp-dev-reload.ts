import type { AstroIntegration } from "astro";
import wpBridgeConfig from "../../../wp-bridge.config";

/**
 * Server-side fetch that handles WP Playground's auto-login 302 with cookies.
 * `origin` is sent as X-Astro-Origin so the WP plugin can auto-discover the
 * Astro frontend URL and rewrite admin permalinks without manual setup.
 */
async function wpFetch(
	url: string,
	cookieJar: { value: string },
	origin?: string | null,
): Promise<Response> {
	const { username, password } = wpBridgeConfig.wordpress.auth;
	const credentials = Buffer.from(`${username}:${password}`).toString(
		"base64",
	);
	let currentUrl = url;
	for (let i = 0; i < 5; i++) {
		const headers: Record<string, string> = {
			Authorization: `Basic ${credentials}`,
		};
		if (origin) headers["X-Astro-Origin"] = origin;
		if (cookieJar.value) headers.Cookie = cookieJar.value;
		const res = await fetch(currentUrl, { headers, redirect: "manual" });
		const setCookies = res.headers.getSetCookie
			? res.headers.getSetCookie()
			: [];
		if (setCookies.length > 0) {
			cookieJar.value = setCookies
				.map((c) => c.split(";")[0])
				.join("; ");
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get("location");
			if (!loc) return res;
			currentUrl = new URL(loc, currentUrl).toString();
			continue;
		}
		return res;
	}
	throw new Error("too many redirects");
}

/**
 * Astro integration for auto-refreshing WordPress content during dev.
 *
 * Registers a `/_wp_check` endpoint on the Vite dev server. The client-side
 * poll script (injected into the page head) hits this endpoint every 3 seconds.
 * When the most recent `modified_gmt` from WordPress changes, the integration
 * calls `refreshContent()` to re-run all content loaders. Astro's built-in
 * file watcher on `data-store.json` then handles Vite module invalidation
 * and triggers a full page reload in the browser automatically.
 *
 * Key design decisions:
 * - First poll always forces a refresh (initial sync) to align the content
 *   store with WP, covering edits made between startup and the first page load.
 * - `refreshContent()` is called without a `loaders` filter to avoid wiping
 *   other collections (e.g. local markdown) during Astro's clearAll pass.
 * - No manual `server.ws.send({ type: 'full-reload' })` — Astro's own watcher
 *   handles it. Sending our own caused races where the browser reloaded before
 *   Vite module invalidation completed, serving stale HTML.
 * - All WP requests are proxied through the dev server to avoid CORS issues
 *   and WP Playground's 302 auto-login complexity in the browser.
 */
export function wpDevReload(): AstroIntegration {
	return {
		name: "wp-dev-reload",
		hooks: {
			"astro:server:setup": ({ server, refreshContent, logger }) => {
				const wpUrl = wpBridgeConfig.wordpress.url;
				const cookieJar = { value: "" };
				let lastModified: string | null = null;
				let hasSynced = false;
				let refreshing = false;

				server.middlewares.use("/_wp_check", async (req, res) => {
					res.setHeader("Content-Type", "application/json");
					if (refreshing) {
						res.statusCode = 200;
						return res.end(JSON.stringify({ status: "busy" }));
					}
					// Derive Astro's own origin from the browser request so WP can
					// rewrite admin links without the user configuring anything.
					const host = req.headers.host;
					const proto =
						(req.headers["x-forwarded-proto"] as string) || "http";
					const origin = host ? `${proto}://${host}` : null;
					try {
						const r = await wpFetch(
							`${wpUrl}/wp-json/wp/v2/posts?per_page=1&orderby=modified&order=desc&_fields=modified_gmt`,
							cookieJar,
							origin,
						);
						if (!r.ok) {
							res.statusCode = 200;
							return res.end(
								JSON.stringify({ status: "wp-error", http: r.status }),
							);
						}
						const data = (await r.json()) as Array<{
							modified_gmt?: string;
						}>;
						const current = data[0]?.modified_gmt ?? null;

						// First poll forces a refresh to align the content store with WP.
						const shouldRefresh =
							!hasSynced ||
							(lastModified !== null && current !== lastModified);

						if (shouldRefresh) {
							refreshing = true;
							const reason = hasSynced
								? `${lastModified} → ${current}`
								: "initial sync";
							logger.info(`refreshing (${reason})`);
							try {
								await refreshContent?.();
							} finally {
								refreshing = false;
								hasSynced = true;
							}
						}
						lastModified = current;
						res.statusCode = 200;
						res.end(JSON.stringify({ status: "ok", modified: current }));
					} catch (err) {
						refreshing = false;
						logger.error(
							`wp-check failed: ${err instanceof Error ? err.message : String(err)}`,
						);
						res.statusCode = 500;
						res.end(JSON.stringify({ status: "error" }));
					}
				});
			},
		},
	};
}
