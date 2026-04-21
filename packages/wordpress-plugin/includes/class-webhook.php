<?php
/**
 * Webhook dispatcher — fires HMAC-signed POST on content changes.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cdx_Webhook {

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
		add_action( 'transition_post_status', array( $this, 'handle_status_change' ), 10, 3 );
	}

	/**
	 * Handle post status transitions.
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Old post status.
	 * @param WP_Post $post       Post object.
	 */
	public function handle_status_change( $new_status, $old_status, $post ) {
		// Only act on public post types.
		$post_type_obj = get_post_type_object( $post->post_type );
		if ( ! $post_type_obj || ! $post_type_obj->public ) {
			return;
		}

		// Only fire on meaningful transitions involving publish or trash.
		if ( $new_status !== 'publish' && $old_status !== 'publish' && $new_status !== 'trash' ) {
			return;
		}

		// Debounce: 2-second window per post.
		$transient_key = 'cdx_webhook_' . $post->ID;
		if ( get_transient( $transient_key ) ) {
			return;
		}
		set_transient( $transient_key, true, 2 );

		$this->fire_webhook( $post, $new_status, $old_status );
	}

	/**
	 * Determine the action type from status transition.
	 *
	 * @param string $new_status New post status.
	 * @param string $old_status Old post status.
	 * @return string Action type.
	 */
	private function get_action_type( $new_status, $old_status ) {
		if ( $new_status === 'publish' && $old_status !== 'publish' ) {
			return 'post_published';
		}
		if ( $new_status === 'trash' ) {
			return 'post_trashed';
		}
		if ( $old_status === 'publish' && $new_status !== 'publish' && $new_status !== 'trash' ) {
			return 'post_unpublished';
		}
		return 'post_updated';
	}

	/**
	 * Fire the webhook request.
	 *
	 * @param WP_Post $post       Post object.
	 * @param string  $new_status New post status.
	 * @param string  $old_status Old post status.
	 */
	private function fire_webhook( $post, $new_status, $old_status ) {
		$webhook_url = isset( $this->options['webhook_url'] ) ? $this->options['webhook_url'] : '';
		$secret      = isset( $this->options['webhook_secret'] ) ? $this->options['webhook_secret'] : '';

		if ( empty( $webhook_url ) ) {
			return;
		}

		$action = $this->get_action_type( $new_status, $old_status );

		$payload = wp_json_encode(
			array(
				'action'         => $action,
				'post_id'        => $post->ID,
				'post_type'      => $post->post_type,
				'slug'           => $post->post_name,
				'status'         => $new_status,
				'modified_gmt'   => get_post_modified_time( 'c', true, $post ),
				'bridge_version' => CDX_VERSION,
			)
		);

		$signature = hash_hmac( 'sha256', $payload, $secret );

		wp_remote_post(
			$webhook_url,
			array(
				'body'     => $payload,
				'headers'  => array(
					'Content-Type'     => 'application/json',
					'X-Astro-Signature' => $signature,
					'X-Astro-Event'    => $action,
				),
				'timeout'  => 5,
				'blocking' => false,
			)
		);

		// Store last webhook info for health endpoint.
		update_option(
			'cdx_last_webhook',
			array(
				'action'    => $action,
				'post_id'   => $post->ID,
				'timestamp' => gmdate( 'c' ),
			)
		);
	}
}
