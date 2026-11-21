import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, acceptContent, shouldConsider } from '../src/interviews/filter.js';
import type { TreeEntry } from '../src/interviews/source.js';

const blob = (path: string, size = 500, mode = '100644'): TreeEntry => ({
  path,
  mode,
  type: 'blob',
  size,
});

describe('shouldConsider', () => {
  it.each([
    'src/server.js',
    'app/main.py',
    'cmd/x/main.go',
    '.env.example',
    '.env.sample',
    'Dockerfile',
  ])('keeps %s', (p) => expect(shouldConsider(blob(p))).toBe(true));

  it.each([
    ['node_modules/a/index.js', 'vendored directory'],
    ['src/vendor/x.go', 'vendored directory'],
    ['dist/app.js', 'build output'],
    ['web/.next/server.js', 'build output'],
    ['pkg/__generated__/api.ts', 'generated directory'],
    ['package-lock.json', 'lockfile'],
    ['go.sum', 'lockfile'],
    ['sub/yarn.lock', 'lockfile'],
    ['public/app.min.js', 'minified'],
    ['public/app.js.map', 'source map'],
    ['api/user.pb.go', 'generated'],
    ['x_pb2.py', 'generated'],
    ['src/api.generated.ts', 'generated'],
    ['__snapshots__/a.snap', 'snapshot'],
    ['.env', 'secret'],
    ['config/.env.production', 'secret'],
    ['certs/server.pem', 'secret'],
    ['id_rsa', 'secret'],
    ['id_ed25519.pub', 'secret'],
    ['.npmrc', 'secret'],
    ['credentials-prod.json', 'secret'],
    ['service-account.json', 'secret'],
    ['infra/terraform.tfstate', 'secret'],
    ['logo.png', 'binary'],
    ['fonts/a.woff2', 'binary'],
    ['a.zip', 'binary'],
    ['lib/x.so', 'binary'],
    ['a.pyc', 'binary'],
    ['analysis.ipynb', 'notebook'],
  ])('skips %s (%s)', (p) => expect(shouldConsider(blob(p))).toBe(false));

  it('skips non-blobs, symlinks, empty and oversized files', () => {
    expect(shouldConsider({ path: 'src', mode: '040000', type: 'tree' })).toBe(false);
    expect(shouldConsider({ path: 'sub', mode: '160000', type: 'commit' })).toBe(false);
    expect(shouldConsider(blob('link.js', 10, '120000'))).toBe(false);
    expect(shouldConsider(blob('a.js', 0))).toBe(false);
    expect(shouldConsider(blob('a.js', MAX_FILE_BYTES + 1))).toBe(false);
    expect(shouldConsider(blob('a.js', MAX_FILE_BYTES))).toBe(true);
  });
});

describe('acceptContent', () => {
  it('accepts ordinary source', () => {
    const r = acceptContent(Buffer.from('const a = 1;\nconst b = 2;\n'));
    expect(r).toEqual({ ok: true, text: 'const a = 1;\nconst b = 2;\n' });
  });

  it('rejects empty, NUL bytes, invalid UTF-8, LFS pointers and minified text', () => {
    expect(acceptContent(Buffer.alloc(0))).toEqual({ ok: false, reason: 'empty' });
    expect(acceptContent(Buffer.from('abc\0def'))).toEqual({ ok: false, reason: 'binary' });
    expect(acceptContent(Buffer.from([0x61, 0xff, 0xfe, 0x62]))).toEqual({
      ok: false,
      reason: 'invalid_utf8',
    });
    const lfs = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n';
    expect(acceptContent(Buffer.from(lfs))).toEqual({ ok: false, reason: 'lfs_pointer' });
    expect(acceptContent(Buffer.from('a=1;'.repeat(200)))).toEqual({
      ok: false,
      reason: 'minified',
    });
  });
});
