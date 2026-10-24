// Runs node:test files in a directory and reports one JSON line per test on the given fd (D-066).
import { once } from 'node:events';
import { readdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { run } from 'node:test';

const [dir, fdArg] = process.argv.slice(2);
const fd = Number(fdArg);
const files = readdirSync(dir)
  .filter((f) => /\.test\.(m?js|cjs)$/.test(f))
  .sort()
  .map((f) => join(process.cwd(), dir, f));

const report = (name, status, message = '') =>
  writeSync(fd, JSON.stringify({ name, status, message: String(message).slice(-2000) }) + '\n');

const stream = run({ files, concurrency: 1, timeout: 5000 });
stream.on('test:pass', (d) => {
  if (d.details?.type !== 'suite' && d.nesting <= 1) report(d.name, 'pass');
});
stream.on('test:fail', (d) => {
  if (d.details?.type === 'suite') return;
  const err = d.details?.error?.cause ?? d.details?.error;
  const message = err?.message ?? String(err ?? 'failed');
  report(
    d.name,
    err?.code === 'ERR_ASSERTION' || err?.name === 'AssertionError' ? 'fail' : 'error',
    message,
  );
});
stream.on('test:stdout', (d) => process.stdout.write(d.message));
stream.on('test:stderr', (d) => process.stderr.write(d.message));
stream.resume(); // events fire as the stream is consumed
await once(stream, 'end');
