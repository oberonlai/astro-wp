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
};
