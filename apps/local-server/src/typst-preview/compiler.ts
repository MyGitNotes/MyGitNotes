import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUN_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 3000;
const MAX_LOG_BYTES = 64 * 1024;
const MAX_CONCURRENT = 2;
/**
 * What the toolkit and Typst need from the server's environment. Everything else stays behind, so server secrets
 * (`SESSION_SECRET`, provider tokens, `MYGITNOTES_*`) never reach code that lives in the workspace.
 */
const ENVIRONMENT = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TYPST_PACKAGE_PATH', 'TYPST_PACKAGE_CACHE_PATH'];

/** One compile to run. Every value comes from the detected project and the installed toolkit, none from a request. */
export interface CompileJob {
  /** Names the project and target; runs with one key never overlap, and its PDF is kept under it. */
  key: string;
  /** The toolkit's CLI script, run with this server's Node. */
  cli: string;
  /** The directory of `thesis-toolkit.json`. */
  cwd: string;
  project: string;
  target: string;
}

export interface CompileResult {
  ok: boolean;
  /** The first 16 hex digits of the PDF's sha256, when the run succeeded. */
  revision?: string;
  durationMs: number;
  /** The end of what the run printed, standard output and error together. */
  log: string;
}

export interface CompilerOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface Flight {
  running: Promise<CompileResult>;
  /** The one run that starts after `running`, shared by every compile asked for meanwhile. */
  next?: Promise<CompileResult>;
}

const compilers = new Set<PreviewCompiler>();
let hooked = false;

/** Kills live runs and removes the PDFs when the server ends, whether it exits or is signalled. */
function hookProcessEnd(): void {
  if (hooked) return;
  hooked = true;
  const disposeAll = () => {
    for (const compiler of [...compilers]) compiler.dispose();
  };
  process.on('exit', disposeAll);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const onSignal = () => {
      disposeAll();
      // Hand the signal back to whatever would have happened without this listener.
      process.removeListener(signal, onSignal);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

/** Appends to a log kept to its last `MAX_LOG_BYTES`. */
function tail(log: Buffer, chunk: Buffer): Buffer {
  const joined = Buffer.concat([log, chunk]);
  return joined.length > MAX_LOG_BYTES ? joined.subarray(joined.length - MAX_LOG_BYTES) : joined;
}

/**
 * Runs `thesis-toolkit compile <project> <target> --output <file>` and keeps the last good PDF of each key in a
 * directory of its own under the system's temporary directory, so a preview never writes into the worktree.
 * A compile asked for while its key is running waits for one more run that starts afterwards (its save may be newer
 * than what the running one read), and at most two runs are alive at once.
 */
export class PreviewCompiler {
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly flights = new Map<string, Flight>();
  private readonly pdfs = new Map<string, { revision: string; file: string; }>();
  private readonly children = new Set<ChildProcess>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;
  private directory: string | undefined;
  private serial = 0;
  private disposed = false;

  constructor({ timeoutMs = RUN_TIMEOUT_MS, killGraceMs = KILL_GRACE_MS, env = process.env }: CompilerOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.killGraceMs = killGraceMs;
    this.env = env;
  }

  compile(job: CompileJob): Promise<CompileResult> {
    const flight = this.flights.get(job.key);
    if (!flight) return this.start(job);
    flight.next ??= flight.running.then(() => this.start(job));
    return flight.next;
  }

  /** The last good PDF of a key. */
  pdf(key: string): { revision: string; file: string; } | undefined {
    return this.pdfs.get(key);
  }

  /** Kills every live run and removes the PDFs. The compiler runs nothing afterwards. */
  dispose(): void {
    this.disposed = true;
    compilers.delete(this);
    for (const child of this.children) child.kill('SIGKILL');
    this.pdfs.clear();
    for (const release of this.waiting.splice(0)) release();
    if (this.directory) fs.rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }

  private start(job: CompileJob): Promise<CompileResult> {
    const running = this.run(job).finally(() => {
      // The follow-up, if any, has taken this flight over by starting; otherwise the key is idle.
      if (this.flights.get(job.key)?.running === running) this.flights.delete(job.key);
    });
    this.flights.set(job.key, { running });
    return running;
  }

  private async run(job: CompileJob): Promise<CompileResult> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active += 1;
    try {
      if (this.disposed) return { ok: false, durationMs: 0, log: 'The preview compiler has stopped.' };
      return await this.spawn(job);
    } finally {
      // A waiting run takes this slot over; without one it is free again.
      const release = this.waiting.shift();
      if (release) release();
      else this.active -= 1;
    }
  }

  private outputDirectory(): string {
    if (!this.directory) {
      this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-typst-preview-'));
      compilers.add(this);
      hookProcessEnd();
    }
    return this.directory;
  }

  private spawn(job: CompileJob): Promise<CompileResult> {
    const started = performance.now();
    const directory = this.outputDirectory();
    const name = createHash('sha256').update(job.key).digest('hex').slice(0, 32);
    const output = path.join(directory, `${name}-${this.serial += 1}.pdf`);
    const env: NodeJS.ProcessEnv = {};
    for (const key of ENVIRONMENT) if (this.env[key] !== undefined) env[key] = this.env[key];
    return new Promise<CompileResult>(resolve => {
      // Not detached: Ctrl-C and a kill of the server's process group reach the run too.
      const child = spawn(process.execPath, [job.cli, 'compile', job.project, job.target, '--output', output], { cwd: job.cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(child);
      let log: Buffer = Buffer.alloc(0), timedOut = false, settled = false;
      child.stdout.on('data', (chunk: Buffer) => log = tail(log, chunk));
      child.stderr.on('data', (chunk: Buffer) => log = tail(log, chunk));
      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs);
      }, this.timeoutMs);
      const finish = (code: number | null, failure?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        this.children.delete(child);
        const durationMs = Math.round(performance.now() - started);
        const notes: string[] = [];
        if (failure) notes.push(failure);
        if (timedOut) notes.push(`The compile timed out after ${Math.round(this.timeoutMs / 1000)} s and was stopped.`);
        let result: CompileResult | undefined;
        if (code === 0 && !timedOut && !this.disposed) {
          try {
            const revision = createHash('sha256').update(fs.readFileSync(output)).digest('hex').slice(0, 16);
            const file = path.join(directory, `${name}.pdf`);
            fs.renameSync(output, file);
            this.pdfs.set(job.key, { revision, file });
            result = { ok: true, revision, durationMs, log: '' };
          } catch {
            notes.push('The compile ended without writing a PDF.');
          }
        }
        fs.rmSync(output, { force: true });
        const text = [log.toString('utf8').replace(/^\uFFFD+/, ''), ...notes].filter(Boolean).join('\n');
        // The notes are part of the log, which stays within its limit from the end.
        const bounded = Buffer.byteLength(text) > MAX_LOG_BYTES ? Buffer.from(text).subarray(-MAX_LOG_BYTES).toString('utf8').replace(/^\uFFFD+/, '') : text;
        resolve(result ? { ...result, log: bounded } : { ok: false, durationMs, log: bounded });
      };
      child.once('error', error => finish(null, `The toolkit could not be started: ${error.message}`));
      child.once('close', code => finish(code));
    });
  }
}
