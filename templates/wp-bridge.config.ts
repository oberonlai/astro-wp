/**
 * Astro CMS Connect configuration.
 *
 * WordPress URL and auth credentials for the content loader.
 * The loader fetches posts from the REST API at build time.
 */
export default {
	wordpress: {
		url: "http://localhost:8888",
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
};
