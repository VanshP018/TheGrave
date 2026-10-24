import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ProjectLanguage, ProjectTestResult } from '@thegrave/shared';
import { JudgeError } from '../judge/executor.js';

export type WorkspaceRequest =
  { mode: 'exec'; command: string } | { mode: 'test'; testDir: string };

export interface WorkspaceResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  timeMs: number;
  /** Only for test mode. */
  results: ProjectTestResult[];
}

export interface WorkspaceRunner {
  run(
    language: ProjectLanguage,
    files: Record<string, string>,
    req: WorkspaceRequest,
    timeoutMs: number,
  ): Promise<WorkspaceResult>;
}

const OUTPUT_LIMIT = 64 * 1024;
const STARTUP_BUDGET_MS = 10_000;

/**
 * One throwaway container per run (decision.md D-066), with the DSA judge's lockdown: no network, read-only
 * root, a small tmpfs, unprivileged user, no capabilities, capped memory/CPU/processes. The project goes in
 * as JSON on stdin; nothing is mounted, so this works against a remote Docker daemon too.
 */
export class WorkspaceExecutor implements WorkspaceRunner {
  constructor(private readonly opts: { image: string; runtime?: string | undefined }) {}

  dockerArgs(name: string): string[] {
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
      '320m',
      '--memory-swap',
      '320m',
      '--cpus',
      '1',
      // node:test runs each file in a child process; headroom for that, still far from a fork bomb.
      '--pids-limit',
      '96',
      '--user',
      '65534:65534',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--ulimit',
      'nofile=128:128',
      '--log-driver',
      'none',
      '--hostname',
      'sandbox',
      ...(this.opts.runtime ? ['--runtime', this.opts.runtime] : []),
      this.opts.image,
    ];
  }

  async run(
    language: ProjectLanguage,
    files: Record<string, string>,
    req: WorkspaceRequest,
    timeoutMs: number,
  ): Promise<WorkspaceResult> {
    const name = `workspace-${randomUUID()}`;
    const child = spawn('docker', this.dockerArgs(name), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    // The runner enforces `timeoutMs` itself; this is the backstop for a wedged container.
    const kill = setTimeout(
      () => spawn('docker', ['kill', name], { stdio: 'ignore' }),
      timeoutMs + STARTUP_BUDGET_MS,
    );
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', (err) => reject(new JudgeError(`failed to start docker: ${err.message}`)));
      child.on('close', resolve);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(
      JSON.stringify({ ...req, language, files, timeoutMs, outputLimit: OUTPUT_LIMIT }),
    );
    let code: number | null;
    try {
      code = await exited;
    } finally {
      clearTimeout(kill);
    }
    const line = stdout.trim().split('\n').pop();
    if (!line) throw new JudgeError(`workspace container exited (code ${code}): ${stderr.trim()}`);
    let parsed: {
      exitCode: number | null;
      output: string;
      timedOut: boolean;
      timeMs: number;
      results?: ProjectTestResult[];
    };
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new JudgeError(`workspace runner protocol error: ${line.slice(0, 200)}`);
    }
    return {
      exitCode: parsed.exitCode,
      output: parsed.output,
      timedOut: parsed.timedOut,
      timeMs: parsed.timeMs,
      results: parsed.results ?? [],
    };
  }
}
