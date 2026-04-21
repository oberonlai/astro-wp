<?php
/**
 * Settings page for Astro CMS Connect.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cdx_Settings {

	/**
	 * Option name in wp_options table.
	 *
	 * @var string
	 */
	private $option_name = 'cdx_settings';

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_settings_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Add settings page under Settings menu.
	 */
	public function add_settings_page() {
		add_options_page(
			__( 'Astro CMS Connect', 'cdx-cms' ),
			__( 'Astro CMS Connect', 'cdx-cms' ),
			'manage_options',
			'cdx-cms',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Register settings and fields.
	 */
	public function register_settings() {
		register_setting(
			'cdx_settings_group',
			$this->option_name,
			array( $this, 'sanitize_settings' )
		);

		add_settings_section(
			'cdx_main',
			__( 'General Settings', 'cdx-cms' ),
			null,
			'cdx-cms'
		);

		add_settings_field(
			'enabled',
			__( 'Enable', 'cdx-cms' ),
			array( $this, 'render_enabled_field' ),
			'cdx-cms',
			'cdx_main'
		);

		add_settings_field(
			'astro_url',
			__( 'Astro Frontend URL', 'cdx-cms' ),
			array( $this, 'render_astro_url_field' ),
			'cdx-cms',
			'cdx_main'
		);

		add_settings_field(
			'webhook_url',
			__( 'Webhook URL', 'cdx-cms' ),
			array( $this, 'render_webhook_url_field' ),
			'cdx-cms',
			'cdx_main'
		);

		add_settings_field(
			'webhook_secret',
			__( 'Webhook Secret', 'cdx-cms' ),
			array( $this, 'render_webhook_secret_field' ),
			'cdx-cms',
			'cdx_main'
		);
	}

	/**
	 * Sanitize settings before saving.
	 *
	 * @param array $input Raw input values.
	 * @return array Sanitized values.
	 */
	public function sanitize_settings( $input ) {
		$sanitized = array();

		$sanitized['enabled']        = isset( $input['enabled'] ) ? (bool) $input['enabled'] : false;
		$sanitized['astro_url']      = isset( $input['astro_url'] ) ? esc_url_raw( $input['astro_url'] ) : '';
		$sanitized['webhook_url']    = isset( $input['webhook_url'] ) ? esc_url_raw( $input['webhook_url'] ) : '';

		// Preserve the auto-generated secret.
		$current_options             = get_option( $this->option_name, array() );
		$sanitized['webhook_secret'] = isset( $current_options['webhook_secret'] ) ? $current_options['webhook_secret'] : '';

		return $sanitized;
	}

	/**
	 * Render the enabled checkbox field.
	 */
	public function render_enabled_field() {
		$options = get_option( $this->option_name, array() );
		$checked = isset( $options['enabled'] ) ? (bool) $options['enabled'] : false;
		printf(
			'<input type="checkbox" name="%s[enabled]" value="1" %s /> %s',
			esc_attr( $this->option_name ),
			checked( $checked, true, false ),
			esc_html__( 'Enable webhooks on content changes', 'cdx-cms' )
		);
	}

	/**
	 * Render the Astro URL field.
	 */
	public function render_astro_url_field() {
		$options   = get_option( $this->option_name, array() );
		$astro_url = isset( $options['astro_url'] ) ? $options['astro_url'] : '';
		printf(
			'<input type="url" name="%s[astro_url]" value="%s" class="regular-text" placeholder="https://example.com" />',
			esc_attr( $this->option_name ),
			esc_attr( $astro_url )
		);
		echo '<p class="description">' . esc_html__( 'The public URL of your Astro frontend.', 'cdx-cms' ) . '</p>';
	}

	/**
	 * Render the webhook URL field.
	 */
	public function render_webhook_url_field() {
		$options     = get_option( $this->option_name, array() );
		$webhook_url = isset( $options['webhook_url'] ) ? $options['webhook_url'] : '';
		printf(
			'<input type="url" name="%s[webhook_url]" value="%s" class="regular-text" placeholder="https://api.cloudflare.com/..." />',
			esc_attr( $this->option_name ),
			esc_attr( $webhook_url )
		);
		echo '<p class="description">' . esc_html__( 'Deploy hook URL (e.g., Cloudflare Pages, Vercel, Netlify).', 'cdx-cms' ) . '</p>';
	}

	/**
	 * Render the webhook secret field (readonly).
	 */
	public function render_webhook_secret_field() {
		$options = get_option( $this->option_name, array() );
		$secret  = isset( $options['webhook_secret'] ) ? $options['webhook_secret'] : '';
		printf(
			'<input type="text" value="%s" class="regular-text" readonly />',
			esc_attr( $secret )
		);
		echo '<p class="description">' . esc_html__( 'Auto-generated. Copy this to your Astro project config for HMAC verification.', 'cdx-cms' ) . '</p>';
	}

	/**
	 * Render the settings page.
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<form action="options.php" method="post">
				<?php
				settings_fields( 'cdx_settings_group' );
				do_settings_sections( 'cdx-cms' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
