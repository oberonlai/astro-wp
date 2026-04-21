<?php
/**
 * REST API extensions — health endpoint.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cdx_REST {

	/**
	 * Plugin options.
	 *
	 * @var array
	 */
	private $options;

	/**
	 * Constructor.
	 *
	 * @param array $options Plugin options.
	 */
	public function __construct( $options ) {
		$this->options = $options;
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST routes.
	 */
	public function register_routes() {
		register_rest_route(
			'cdx/v1',
			'/health',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'health_check' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Health check endpoint.
	 *
	 * @return WP_REST_Response Health status response.
	 */
	public function health_check() {
		$last_webhook = get_option( 'cdx_last_webhook', null );
		$webhook_url  = isset( $this->options['webhook_url'] ) ? $this->options['webhook_url'] : '';

		return new WP_REST_Response(
			array(
				'status'         => 'ok',
				'version'        => CDX_VERSION,
				'wp_version'     => get_bloginfo( 'version' ),
				'php_version'    => phpversion(),
				'webhook_active' => ! empty( $webhook_url ),
				'last_webhook'   => $last_webhook,
				'timestamp'      => gmdate( 'c' ),
			),
			200
		);
	}
}
