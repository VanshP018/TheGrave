import type { TreeEntry } from './source.js';

/** Largest file we will fetch (plan.md 6.3). */
export const MAX_FILE_BYTES = 64 * 1024;

const SKIP_DIRS = new Set(
  (
    'node_modules vendor third_party dist build out target .next .nuxt coverage __pycache__ .venv venv .git ' +
    '.idea .vscode bower_components Pods .gradle generated gen __generated__'
  ).split(' '),
);

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  'composer.lock',
  'Gemfile.lock',
  'mix.lock',
  'packages.lock.json',
]);

const GENERATED = [
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.pb\.go$/i,
  /_pb2\.py$/i,
  /\.generated\./i,
  /\.g\.dart$/i,
  /\.snap$/i,
];

const SECRET_NAMES = [
  /\.(pem|key|p12|pfx|jks|keystore|tfstate)$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^\.(npmrc|pypirc|netrc)$/i,
  /^credentials.*\.json$/i,
  /^service-account.*\.json$/i,
];

const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif bmp ico webp avif tiff psd svgz heic ttf otf woff woff2 eot zip tar gz tgz bz2 xz 7z rar ' +
    'mp3 mp4 mov avi mkv webm wav ogg flac pdf exe dll so dylib wasm class jar pyc pyo o a lib bin sqlite sqlite3 ' +
    'db ipynb dmg iso'
  ).split(' '),
);

function isSecretName(name: string): boolean {
  if (name === '.env') return true;
  if (name.startsWith('.env.')) return !/^\.env\.(example|sample)$/i.test(name);
  return SECRET_NAMES.some((re) => re.test(name));
}

/** Tree-level skip rules: false = never fetched, never sent anywhere (plan.md 6.3). */
export function shouldConsider(entry: TreeEntry): boolean {
  if (entry.type !== 'blob' || entry.mode === '120000') return false;
  if (entry.size !== undefined && (entry.size === 0 || entry.size > MAX_FILE_BYTES)) return false;
  const parts = entry.path.split('/');
  const name = parts[parts.length - 1]!;
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return false;
  if (LOCKFILES.has(name)) return false;
  if (GENERATED.some((re) => re.test(name))) return false;
  if (isSecretName(name)) return false;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())) return false;
  return true;
}

export type ContentVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: 'binary' | 'invalid_utf8' | 'lfs_pointer' | 'minified' | 'empty' };

/** Content-level rules, after fetch: NUL byte, invalid UTF-8, Git LFS pointer, minified (avg line > 300). */
export function acceptContent(buf: Buffer): ContentVerdict {
  if (buf.length === 0) return { ok: false, reason: 'empty' };
  if (buf.subarray(0, 8192).includes(0)) return { ok: false, reason: 'binary' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return { ok: false, reason: 'invalid_utf8' };
  }
  if (text.startsWith('version https://git-lfs.github.com/spec'))
    return { ok: false, reason: 'lfs_pointer' };
  const lines = text.split('\n').length;
  if (text.length / lines > 300) return { ok: false, reason: 'minified' };
  return { ok: true, text };
}
