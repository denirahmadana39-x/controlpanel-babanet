export const ENGINE_EXTENSIONS = {
  ALLOWED: new Set([
    "html",
    "htm",
    "css",
    "js",
    "mjs",
    "cjs",
    "json",
    "map",
    "webmanifest",
    "wasm",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "avif",
    "ico",
    "bmp",
    "txt",
    "pdf",
    "xml",
    "webm",
    "mp4",
    "mp3",
    "ogg",
    "wav",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
  ]),
  FORBIDDEN: new Set([
    "php",
    "php3",
    "php4",
    "php5",
    "phtml",
    "phps",
    "asp",
    "aspx",
    "jsp",
    "cgi",
    "shtml",
    "sh",
    "bat",
    "cmd",
    "exe",
    "com",
    "dll",
    "so",
    "bin",
    "py",
    "pl",
    "rb",
    "pyc",
    "jar",
    "war",
    "sql",
  ]),
} as const;

/**
 * Single source of truth for engine defaults. Both the API and worker config
 * schemas derive their defaults from here so they can never drift.
 */
export const ENGINE_DEFAULTS = {
  PUBLIC_BASE_DOMAIN: "localhost",
  NGINX_PORT: 80,
  NGINX_BIN: "nginx",
  NGINX_SITES_AVAILABLE: "/etc/nginx/sites-available",
  NGINX_SITES_ENABLED: "/etc/nginx/sites-enabled",
  TEMP_DIRECTORY: "/tmp/hosting-panel",
  UPLOAD_MAX_SIZE_MB: 100,
  MAX_ZIP_ENTRIES: 10_000,
  MAX_EXTRACTED_SIZE_MB: 500,
  MAX_SINGLE_FILE_SIZE_MB: 200,
  VERSION_RETENTION: 5,
  TEMP_AGE_HOURS: 24,
} as const;

export const ENGINE_LIMITS = {
  MAX_UPLOAD_SIZE_MB: ENGINE_DEFAULTS.UPLOAD_MAX_SIZE_MB,
  MAX_ZIP_ENTRIES: ENGINE_DEFAULTS.MAX_ZIP_ENTRIES,
  MAX_EXTRACTED_SIZE_MB: ENGINE_DEFAULTS.MAX_EXTRACTED_SIZE_MB,
  MAX_SINGLE_FILE_SIZE_MB: ENGINE_DEFAULTS.MAX_SINGLE_FILE_SIZE_MB,
  VERSION_RETENTION: ENGINE_DEFAULTS.VERSION_RETENTION,
  TEMP_AGE_HOURS: ENGINE_DEFAULTS.TEMP_AGE_HOURS,
} as const;

export const DEFAULT_INDEX_FILE = "index.html";

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isAllowedStaticFile(path: string): boolean {
  const extension = extensionOf(path);
  if (ENGINE_EXTENSIONS.FORBIDDEN.has(extension)) return false;
  if (extension.length === 0) return true;
  return ENGINE_EXTENSIONS.ALLOWED.has(extension);
}

export function isHiddenPath(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.some((segment) => segment.startsWith("."));
}
