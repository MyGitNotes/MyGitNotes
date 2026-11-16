/**
 * The Gists this browser created for notes, by repository and note path. A commit sends the one a note still names as
 * its confirmation, so the server pushes the note to it without asking. They are kept apart from the drafts, which the
 * web panel's agent tools edit, so an agent cannot confirm a Gist by writing its id into a note.
 */
const KEY = 'mygitnotes:created-gists';

type Created = Record<string, Record<string, string>>;

function read(): Created {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Created : {};
  } catch {
    return {};
  }
}

function write(created: Created) {
  try {
    localStorage.setItem(KEY, JSON.stringify(created));
  } catch {
    // Without storage the commit asks the person instead.
  }
}

/** Records the Gist this browser created for the note at `path` of `repository`. */
export function rememberCreatedGist(repository: string, path: string, id: string): void {
  const created = read();
  write({ ...created, [repository]: { ...created[repository], [path]: id } });
}

/** Drops the Gist recorded for the note, as when it is unpublished. */
export function forgetCreatedGist(repository: string, path: string): void {
  const created = read();
  if (!created[repository]?.[path]) return;
  const { [path]: _gone, ...rest } = created[repository];
  const { [repository]: _repository, ...others } = created;
  write(Object.keys(rest).length ? { ...others, [repository]: rest } : others);
}

/** The confirmations a commit of `notes` to `repository` sends: each note that names the Gist this browser created for it. */
export function createdGistConfirmations(repository: string, notes: readonly { path: string; metadata: Record<string, unknown>; }[]): { path: string; gist: string; }[] {
  const created = read()[repository] ?? {};
  return notes.flatMap(note => typeof note.metadata.gist === 'string' && note.metadata.gist && created[note.path] === note.metadata.gist ? [{ path: note.path, gist: note.metadata.gist }] : []);
}
