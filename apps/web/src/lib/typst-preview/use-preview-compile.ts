import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, compileTypstPreview, fetchTypstPreviewPdf } from '../api.js';
import { onLocalSave } from './local-save-events.js';

/** One project and target to keep compiled. */
export interface PreviewJob {
  /** Names the project and target; another key starts over with no PDF. */
  key: string;
  /** A note of the project, which names it to the server. */
  path: string;
  notebookId?: string;
  /** The project's directory in its worktree; a saved note under it belongs to the project. */
  directory: string;
  target: string;
}

export interface PreviewPdf {
  revision: string;
  bytes: Uint8Array;
}

export interface PreviewFailure {
  /** The first `error:` line of the log, or what went wrong with the request. */
  message: string;
  log: string;
}

interface CompileState {
  key: string;
  pdf: PreviewPdf | null;
  failure: PreviewFailure | null;
  running: number;
  durationMs?: number;
}

const idle = (key: string): CompileState => ({ key, pdf: null, failure: null, running: 0 });

function firstErrorLine(log: string): string {
  const lines = log.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.find(line => /^error\b/i.test(line)) ?? lines.at(-1) ?? '';
}

const inProject = (path: string, directory: string) => path.startsWith(`${directory}/`);

/**
 * Keeps the PDF of `job` current: it compiles when the job starts, after each local save of a note in the project, and
 * when `compile` is called. The server runs at most one more compile behind a running one, so every request is simply
 * sent; a result is applied only when no later request has been applied, and a failure keeps the last good PDF.
 */
export function usePreviewCompile(job: PreviewJob | null): { pdf: PreviewPdf | null; failure: PreviewFailure | null; compiling: boolean; durationMs?: number; compile: () => void; } {
  const key = job?.key ?? '';
  const [state, setState] = useState<CompileState>(() => idle(key));
  const latest = useRef(job);
  const issued = useRef(0), applied = useRef(0), shownRevision = useRef<string>();
  useEffect(() => {
    latest.current = job;
  });
  const compile = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    const sequence = issued.current += 1;
    const mine = (next: (state: CompileState) => CompileState) => setState(state => state.key === current.key ? next(state) : state);
    // A result older than one already applied would take the preview back in time.
    const fresh = () => latest.current?.key === current.key && sequence > applied.current;
    // The first request of another project or target starts it with nothing on screen.
    setState(state => state.key === current.key ? { ...state, running: state.running + 1 } : { ...idle(current.key), running: 1 });
    void (async () => {
      try {
        const result = await compileTypstPreview(current.path, current.notebookId, current.target);
        if (!fresh()) return;
        if (!result.ok || !result.revision) {
          applied.current = sequence;
          mine(state => ({ ...state, failure: { message: firstErrorLine(result.log), log: result.log }, durationMs: result.durationMs }));
          return;
        }
        const revision = result.revision;
        let bytes: Uint8Array | undefined;
        try {
          if (shownRevision.current !== revision) bytes = await fetchTypstPreviewPdf(current.path, current.notebookId, current.target, revision);
        } catch (error) {
          // A newer PDF replaced this revision before it was fetched; the request that made it brings it.
          if (error instanceof ApiError && error.status === 409) return;
          throw error;
        }
        if (!fresh()) return;
        applied.current = sequence;
        shownRevision.current = revision;
        mine(state => ({ ...state, failure: null, durationMs: result.durationMs, pdf: bytes ? { revision, bytes } : state.pdf }));
      } catch (error) {
        if (fresh()) mine(state => ({ ...state, failure: { message: error instanceof Error ? error.message : String(error), log: '' } }));
      } finally {
        mine(state => ({ ...state, running: state.running - 1 }));
      }
    })();
  }, []);
  // Another project or target starts with nothing on screen and one compile.
  useEffect(() => {
    shownRevision.current = undefined;
    applied.current = issued.current;
    if (key) compile();
  }, [key, compile]);
  const directory = job?.directory;
  useEffect(() =>
    directory === undefined ? undefined : onLocalSave(note => {
      if (inProject(note.path, directory)) compile();
    }), [directory, compile]);
  const shown = state.key === key ? state : idle(key);
  return { pdf: shown.pdf, failure: shown.failure, compiling: shown.running > 0, durationMs: shown.durationMs, compile };
}
