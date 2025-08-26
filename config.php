<?php
// config.php
// Single import point for the PHP site. Reads from env (.env via phpdotenv if available).

// 1) Try to load .env via vlucas/phpdotenv if installed (Composer).
$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) {
  require_once $autoload;
  if (class_exists(Dotenv\Dotenv::class)) {
    // Adjust path to project root if needed
    $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();
  }
}

// 2) Helpers to read env safely
function envv(string $key, $default = null) {
  if (array_key_exists($key, $_ENV)) return $_ENV[$key];
  if (array_key_exists($key, $_SERVER)) return $_SERVER[$key];
  $val = getenv($key);
  return $val !== false ? $val : $default;
}

function env_required(string $key): string {
  $v = envv($key, null);
  if ($v === null || $v === '') {
    throw new RuntimeException("[config] Missing required env var: {$key}");
  }
  return $v;
}

function env_csv(string $key, array $default = []): array {
  $raw = envv($key, '');
  if ($raw === '' || $raw === null) return $default;
  $parts = array_map('trim', explode(',', $raw));
  $parts = array_values(array_filter($parts, fn($s) => $s !== ''));
  return $parts;
}

// 3) Define constants (or export a $CONFIG array if you prefer)
define('DB_HOST', env_required('DB_HOST'));
define('DB_USER', env_required('DB_USER'));
define('DB_PASS', env_required('DB_PASSWORD'));
define('DB_NAME', env_required('DB_NAME'));

define('DISCORD_CLIENT_ID', env_required('DISCORD_CLIENT_ID'));
define('DISCORD_CLIENT_SECRET', envv('DISCORD_CLIENT_SECRET', '')); // optional for OAuth
define('DISCORD_REDIRECT_URI', envv('DISCORD_REDIRECT_URI', 'https://ladder.axxe.gg/login.php'));

define('DISCORD_TOKEN', envv('DISCORD_TOKEN', '')); // optional (if site checks bot membership)
define('DISCORD_GUILD_ID', env_required('DISCORD_GUILD_ID'));

// Arrays in constants require PHP 7+. If unsure, keep as CSV string and explode at use-site.
define('LADDER_ADMIN_ROLE_IDS', env_csv('LADDER_ADMIN_ROLE_IDS')); // array of strings

// Optional behavior flags (use as needed)
define('DEFAULT_LOCALE', envv('DEFAULT_LOCALE', 'pt-PT'));
define('LOG_CHANNEL_ID', envv('LOG_CHANNEL_ID', null));
