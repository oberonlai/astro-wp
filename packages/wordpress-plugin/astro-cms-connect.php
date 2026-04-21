<?php
/**
 * Plugin Name: Astro CMS Connect
 * Description: Connects WordPress to an Astro frontend via webhooks on content changes.
 * Version: 1.0.0
 * Author: Codotx
 * License: MIT
 * Text Domain: cdx-cms
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CDX_VERSION', '1.0.0' );
define( 'CDX_PATH', plugin_dir_path( __FILE__ ) );

require_once CDX_PATH . 'includes/class-webhook.php';
require_once CDX_PATH . 'includes/class-rest.php';
require_once CDX_PATH . 'includes/class-discover.php';
require_once CDX_PATH . 'includes/class-permalink.php';
require_once CDX_PATH . 'admin/class-settings.php';

/**
 * Initialize the plugin.
 */
function cdx_init() {
	$options = get_option( 'cdx_settings', array() );

	// Settings page is always available.
	new Cdx_Settings();

	// Discover + permalink work independently of the webhook enable flag.
	// The editor "View Post" / preview links should point at Astro whenever
	// an origin is known — either auto-discovered from the dev server or
	// configured in settings for production.
	new Cdx_Discover();
	new Cdx_Permalink( $options );

	$enabled = isset( $options['enabled'] ) ? (bool) $options['enabled'] : false;
	if ( ! $enabled ) {
		return;
	}

	new Cdx_Webhook( $options );
	new Cdx_REST( $options );
}
add_action( 'init', 'cdx_init' );

/**
 * Auto-generate webhook secret on activation.
 */
function cdx_activate() {
	$options = get_option( 'cdx_settings', array() );
	if ( empty( $options['webhook_secret'] ) ) {
		$options['webhook_secret'] = wp_generate_password( 32, false );
		update_option( 'cdx_settings', $options );
	}
}
register_activation_hook( __FILE__, 'cdx_activate' );
