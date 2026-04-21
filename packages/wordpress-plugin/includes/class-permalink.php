<?php
/**
 * Rewrites post permalinks and preview links to point at the Astro frontend.
 * Applies to the "View Post" notice and the preview icon in the editor.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cdx_Permalink {

	/**
	 * Plugin options.
	 *
	 * @var array
	 */
	private $options;

	/**
	 * Path prefix in front of the slug on the Astro side.
	 * e.g. /blog/ means a post with slug "hello" maps to <astro_url>/blog/hello/.
	 *
	 * @var string
	 */
	private $path_prefix = '/blog/';

	/**
	 * Constructor.
	 *
	 * @param array $options Plugin options.
	 */
	public function __construct( $options ) {
		$this->options = $options;

		// Always register filters; they'll no-op at call time if no Astro URL
		// is available (neither discovered at runtime nor configured).
		add_filter( 'post_link', array( $this, 'rewrite_post_link' ), 10, 2 );
		add_filter( 'post_type_link', array( $this, 'rewrite_post_link' ), 10, 2 );
		add_filter( 'preview_post_link', array( $this, 'rewrite_preview_link' ), 10, 2 );
		add_filter( 'page_link', array( $this, 'rewrite_post_link' ), 10, 2 );

		// Late priority so we override core nodes after they're added.
		add_action( 'admin_bar_menu', array( $this, 'rewrite_admin_bar' ), 100 );
	}

	/**
	 * Rewrite admin bar "Visit Site" / site name link to point at Astro home.
	 * Doesn't touch home_url() itself (unsafe — breaks cookies, oEmbed, REST).
	 *
	 * @param WP_Admin_Bar $wp_admin_bar Admin bar instance.
	 */
	public function rewrite_admin_bar( $wp_admin_bar ) {
		$base = $this->get_base_url();
		if ( ! $base ) {
			return;
		}
		$base = rtrim( $base, '/' ) . '/';

		// Main site-name node (top-left site title in admin).
		foreach ( array( 'site-name', 'view-site' ) as $node_id ) {
			$node = $wp_admin_bar->get_node( $node_id );
			if ( $node ) {
				$node->href = $base;
				$wp_admin_bar->add_node( (array) $node );
			}
		}
	}

	/**
	 * Resolve the Astro base URL.
	 * Prefers the auto-discovered origin from the dev server over the
	 * manually-configured setting (so dev just works; prod uses the setting).
	 *
	 * @return string|null
	 */
	private function get_base_url() {
		$discovered = Cdx_Discover::get_origin();
		if ( $discovered ) {
			return $discovered;
		}
		return ! empty( $this->options['astro_url'] ) ? $this->options['astro_url'] : null;
	}

	/**
	 * Build the Astro URL for a post.
	 *
	 * @param WP_Post|null $post Post object.
	 * @return string|null Astro URL or null if slug unavailable.
	 */
	private function build_astro_url( $post ) {
		if ( ! $post || empty( $post->post_name ) ) {
			return null;
		}
		$base = $this->get_base_url();
		if ( ! $base ) {
			return null;
		}
		$base   = rtrim( $base, '/' );
		$prefix = '/' . trim( $this->path_prefix, '/' ) . '/';
		return $base . $prefix . $post->post_name . '/';
	}

	/**
	 * Rewrite the published post permalink.
	 *
	 * @param string  $permalink Original permalink.
	 * @param WP_Post $post      Post object.
	 * @return string Rewritten permalink or original if unavailable.
	 */
	public function rewrite_post_link( $permalink, $post ) {
		// Only rewrite for public post types.
		$post_type_obj = get_post_type_object( $post->post_type );
		if ( ! $post_type_obj || ! $post_type_obj->public ) {
			return $permalink;
		}
		$url = $this->build_astro_url( $post );
		return $url ? $url : $permalink;
	}

	/**
	 * Rewrite the preview link.
	 * Preview only makes sense once the post has been published (slug exists),
	 * so drafts fall back to WP's default preview.
	 *
	 * @param string  $link Original preview link.
	 * @param WP_Post $post Post object.
	 * @return string Rewritten link or original.
	 */
	public function rewrite_preview_link( $link, $post ) {
		if ( $post->post_status !== 'publish' ) {
			return $link;
		}
		$url = $this->build_astro_url( $post );
		return $url ? $url : $link;
	}
}
