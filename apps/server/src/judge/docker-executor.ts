import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Language, Verdict } from '@thegrave/shared';
import {
  JudgeError,
  normaliseOutput,
  summarise,
  type ExecLimits,
  type ExecResult,
  type ExecTest,
  type ExecTestResult,
  type Executor,
} from './executor.js';

const OUTPUT_LIMIT_BYTES = 8 << 20;
// Container memory = program limit + room for the runner, tmpfs files (tmpfs pages are charged to the cgroup).
const SANDBOX_OVERHEAD_MB = 64;
const COMPILE_BUDGET_MS = 20_000;
const STARTUP_BUDGET_MS = 10_000;

type RunnerLine =
  | { type: 'compile'; ok: boolean; output: string }
  | {
      type: 'test';
      index: number;
      status: 'ok' | 'tle' | 'mle' | 're';
      timeMs: number;
      stdout: string;
      stderr: string;
    }
  | { type: 'done' };

const STATUS_VERDICT: Record<'tle' | 'mle' | 're', Verdict> = {
  tle: 'TLE',
  mle: 'MLE',
  re: 'RUNTIME_ERROR',
};

export interface DockerExecutorOptions {
  image: string;
  runtime?: string | undefined;
}

/**
 * One throwaway container per submission. Code and inputs go in as JSON on stdin (no bind mounts, so this
 * also works against a remote Docker daemon); expected outputs never enter the container.
 */
export class DockerExecutor implements Executor {
  constructor(private readonly opts: DockerExecutorOptions) {}

  dockerArgs(name: string, limits: ExecLimits): string[] {
    const mem = `${limits.memoryLimitMb + SANDBOX_OVERHEAD_MB}m`;
    return [
      'run',
      '-i',
      '--rm',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,exec,nosuid,nodev,size=64m',
      '--memory',
      mem,
      '--memory-swap',
      mem,
      '--cpus',
      '1',
      '--pids-limit',
      '64',
      '--user',
      '65534:65534',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--ulimit',
      'nofile=64:64',
      '--log-driver',
      'none',
      '--hostname',
      'judge',
      ...(this.opts.runtime ? ['--runtime', this.opts.runtime] : []),
      this.opts.image,
    ];
  }

  async run(
    language: Language,
    code: string,
    tests: ExecTest[],
    limits: ExecLimits,
  ): Promise<ExecResult> {
    const name = `judge-${randomUUID()}`;
    const deadlineMs =
      STARTUP_BUDGET_MS + COMPILE_BUDGET_MS + tests.length * (limits.timeLimitMs + 500);

    const child = spawn('docker', this.dockerArgs(name, limits), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });

    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      spawn('docker', ['kill', name], { stdio: 'ignore' });
    }, deadlineMs);

    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', (err) => reject(new JudgeError(`failed to start docker: ${err.message}`)));
      child.on('close', resolve);
    });

    child.stdin.on('error', () => {}); // container may die before reading everything; surfaced via exit code
    child.stdin.end(
      JSON.stringify({
        language,
        code,
        inputs: tests.map((t) => t.input),
        timeLimitMs: limits.timeLimitMs,
        outputLimitBytes: OUTPUT_LIMIT_BYTES,
      }),
    );

    let compile: { ok: boolean; output: string } | null = null;
    const results: ExecTestResult[] = [];
    let done = false;
    let exitCode: number | null;
    try {
      for await (const raw of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        const line = JSON.parse(raw) as RunnerLine;
        if (line.type === 'compile') compile = line;
        else if (line.type === 'done') done = true;
        else {
          const test = tests[line.index];
          if (!test) throw new JudgeError(`runner reported unknown test ${line.index}`);
          const verdict: Verdict =
            line.status === 'ok'
              ? normaliseOutput(line.stdout) === normaliseOutput(test.expected)
                ? 'ACCEPTED'
                : 'WRONG_ANSWER'
              : STATUS_VERDICT[line.status];
          results.push({
            index: line.index,
            verdict,
            timeMs: line.timeMs,
            stdout: line.stdout,
            stderr: line.stderr,
          });
        }
      }
      exitCode = await exited;
    } finally {
      clearTimeout(killTimer);
    }

    if (compile && !compile.ok) {
      const output = compile.output || 'Compilation failed';
      return summarise(
        tests.map((_, index) => ({
          index,
          verdict: 'COMPILE_ERROR',
          timeMs: 0,
          stdout: '',
          stderr: '',
        })),
        output,
      );
    }
    if (!done) {
      if (!timedOut) {
        throw new JudgeError(`judge container exited early (code ${exitCode}): ${stderr.trim()}`);
      }
      // Overall deadline hit: everything that didn't report is a TLE.
      for (let index = results.length; index < tests.length; index++) {
        results.push({ index, verdict: 'TLE', timeMs: limits.timeLimitMs, stdout: '', stderr: '' });
      }
    }
    return summarise(results, compile?.output || null);
  }
}
