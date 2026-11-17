import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, readNote } from './api.js';
import { noteFollowed } from './note-follows.js';
import type { NoteItem } from './types.js';

/**
 * Where the server says a note is that the lists were asked for and did not show: still where it was (`here`, the lists
 * not caught up yet), elsewhere (`moved`: a live note's move or rename by someone else, or its check-in, see
 * docs/specs/2026-11-15-builtin-live-editor §20.4; a target a later move replaced leads there too), or `gone` (not found,
 * and the server knows of nowhere else). `unknown` when the server could not be asked (offline): nothing is concluded.
 */
export type NoteWhereabouts = { kind: 'here'; note: NoteItem; } | { kind: 'moved'; path: string; } | { kind: 'gone'; } | { kind: 'unknown'; error: string; };

/** Asks the server where the note `ref` is, by reading it there. */
export async function locateNote(ref: NoteRef): Promise<NoteWhereabouts> {
  try {
    return { kind: 'here', note: await readNote(ref.path, ref.notebookId) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return error.movedTo && error.movedTo !== ref.path ? { kind: 'moved', path: error.movedTo } : { kind: 'gone' };
    return { kind: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

/** What a note lookup said: the notes it found, and whether it is settled. */
export interface ListedNotes {
  notes: readonly NoteRef[];
  loading: boolean;
  error: string;
  /** When the lists were last read: each read asks again about the notes they did not show. */
  updatedAt?: number;
  /** The notes this browser deleted (a draft deletion), keyed by `noteRefKey`: gone, without asking. */
  withheld?: readonly string[];
}

/**
 * The one place that decides what became of a note the lists no longer show (a Focus tab, the note an address names, an
 * open editor's): it asks the server, for each read of the lists again, and answers per note by `noteRefKey`. A note the
 * lists show, or whose question has no answer yet, has none: nobody may take it for deleted until the answer is `gone`.
 * An earlier answer stands until the next one arrives, so a note already found gone is not shown again meanwhile; it
 * speaks of that absence only, and is forgotten once the lists show the note again, so a later absence waits for its own
 * answer. A note found moved is one the page follows there ({@link noteFollowed}).
 */
export function useNoteWhereabouts(refs: readonly NoteRef[], listed: ListedNotes): ReadonlyMap<string, NoteWhereabouts> {
  const settled = !listed.loading && !listed.error;
  const found = new Set(listed.notes.map(noteRefKey)), withheld = new Set(listed.withheld ?? []);
  const missing = settled ? [...new Map(refs.map(ref => [noteRefKey(ref), { notebookId: ref.notebookId, path: ref.path }])).values()].filter(ref => !found.has(noteRefKey(ref))) : [];
  const asked = missing.filter(ref => !withheld.has(noteRefKey(ref)));
  const askedKey = asked.map(noteRefKey).join('\n');
  const generation = listed.updatedAt ?? 0;
  const [answers, setAnswers] = useState<ReadonlyMap<string, { generation: number; whereabouts: NoteWhereabouts; }>>(() => new Map());
  const answered = useRef(answers), latest = useRef({ asked, missing, settled });
  useEffect(() => {
    answered.current = answers;
    latest.current = { asked, missing, settled };
  });
  useEffect(() => {
    let current = true;
    // The settled lists show every note they are not missing: what was said of its earlier absence is no news of this one.
    if (latest.current.settled) {
      const still = new Set(latest.current.missing.map(noteRefKey));
      /* eslint-disable react/set-state-in-effect -- Each read of the lists settles which answers still speak of a missing note. */
      if ([...answered.current.keys()].some(key => !still.has(key))) setAnswers(previous => new Map([...previous].filter(([key]) => still.has(key))));
      /* eslint-enable react/set-state-in-effect */
    }
    for (const ref of latest.current.asked) {
      const key = noteRefKey(ref);
      if (answered.current.get(key)?.generation === generation) continue;
      void locateNote(ref).then(whereabouts => {
        if (whereabouts.kind === 'moved') noteFollowed(ref.notebookId, ref.path, whereabouts.path);
        if (current) setAnswers(previous => new Map(previous).set(key, { generation, whereabouts }));
      });
    }
    return () => {
      current = false;
    };
  }, [askedKey, generation]);
  const missingKey = missing.map(noteRefKey).join('\n'), withheldKey = [...withheld].join('\n');
  return useMemo(() => {
    const result = new Map<string, NoteWhereabouts>();
    const deleted = new Set(withheldKey ? withheldKey.split('\n') : []);
    for (const key of missingKey ? missingKey.split('\n') : []) {
      if (deleted.has(key)) result.set(key, { kind: 'gone' });
      else {
        const answer = answers.get(key);
        if (answer) result.set(key, answer.whereabouts);
      }
    }
    return result;
  }, [answers, missingKey, withheldKey]);
}

/** The notes `whereabouts` says moved, by path, for notes of `notebookId`, with the path each lies at now. */
export function movedPaths(whereabouts: ReadonlyMap<string, NoteWhereabouts>, refs: readonly NoteRef[]): Map<string, string> {
  const moved = new Map<string, string>();
  for (const ref of refs) {
    const answer = whereabouts.get(noteRefKey(ref));
    if (answer?.kind === 'moved') moved.set(ref.path, answer.path);
  }
  return moved;
}
