/**
 * Astro CMS Connect configuration.
 *
 * WordPress URL and auth credentials for the content loader.
 * The loader fetches posts from the REST API at build time.
 */
export default {
	wordpress: {
		url: "http://127.0.0.1:8888",
		auth: {
			username: "admin",
			password: "", // WordPress Application Password — auto-filled by wp:setup.
		},
	},
	collections: {
		posts: {
			postType: "post",
			collection: "wpNews",
		},
	},
	tunnel: {
		// Optional: set to a hostname on a domain you own in Cloudflare (e.g. "wp.example.com")
		// for a permanent tunnel URL. Leave empty to use a temporary trycloudflare.com URL
		// that changes on every start.
		hostname: "",
	},
	snapshot: {
		// When enabled, the loader writes fully processed posts to `dir` during
		// live fetches (npm run dev / npm run build). When not in dev and
		// WP_LIVE is not set, the loader reads from the snapshot instead of WP.
		// This lets Cloudflare Workers / CI builds that cannot reach localhost
		// WordPress still produce the site from committed files.
		enabled: true,
		dir: "src/config/wp-snapshot",
	},
	images: {
		// Where image handling writes the collection entry's featured image.
		// "auto" = skip featured image (default, safe).
		// Set to a string like "heroImage" or "featuredImage" to match your
		// content collection schema. During `wp:setup`, the AI agent should
		// scan src/content.config.ts and rewrite this value automatically.
		// When set, the loader also writes `<field>Alt` with the image's alt_text.
		featuredImageField: "auto",

		// Local destination for downloaded images (relative to project root).
		// Anything under public/ is served as-is by Astro at runtime.
		downloadDir: "public/wp-images",

		// Public URL prefix used to reference the images in rendered content.
		publicPath: "/wp-images",

		// How to decide whether to re-download an already-present file:
		// - "hash":            re-download only when the URL changes (filename
		//                      embeds a hash of the URL). Best default.
		// - "always-refresh":  always re-download (slow, forces freshness).
		// - "skip-existing":   never re-download once a file is on disk.
		cacheStrategy: "hash",
	},
};
