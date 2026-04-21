<?php
/**
 * Auto-discover the Astro frontend URL from the X-Astro-Origin header
 * sent by the Astro dev integration on each poll.
 * Stored in a transient; expires when the dev server stops polling.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cdx_Discover {

	const TRANSIENT_KEY = 'cdx_astro_origin';
	const TTL           = DAY_IN_SECONDS;

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'capture_origin' ) );
	}

	/**
	 * Capture X-Astro-Origin header on any REST request.
	 * Refreshes TTL on every poll so the value stays alive while dev is running.
	 */
	public function capture_origin() {
		if ( empty( $_SERVER['HTTP_X_ASTRO_ORIGIN'] ) ) {
			return;
		}
		$origin = esc_url_raw( wp_unslash( $_SERVER['HTTP_X_ASTRO_ORIGIN'] ) );
		if ( ! $origin ) {
			return;
		}
		$existing = get_transient( self::TRANSIENT_KEY );
		if ( $existing !== $origin ) {
			set_transient( self::TRANSIENT_KEY, $origin, self::TTL );
		} else {
			// Same origin — refresh TTL without triggering option update.
			set_transient( self::TRANSIENT_KEY, $origin, self::TTL );
		}
	}

	/**
	 * Get the currently discovered origin, if any.
	 *
	 * @return string|null
	 */
	public static function get_origin() {
		$origin = get_transient( self::TRANSIENT_KEY );
		return $origin ? $origin : null;
	}
}
