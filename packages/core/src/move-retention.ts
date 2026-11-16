import { SourceError } from './github-api.js';
import type { RemoteSnapshot, RemoteSource } from './remote-source.js';

/** What a move, rename or folder removal may keep in memory of the files that can link to what moved. */
export const MOVE_RETAINED_BYTES = 32 * 1024 * 1024;
export const moveRetainedError = () => new SourceError('This operation would keep more than 32 MiB of files that may link to the moved path. Move a smaller folder, or one that fewer notes link to.', 413);

/** `raw` with every percent-escape that decodes cleanly decoded, so a link names a file however its characters are escaped. */
export const unescaped = (raw: string) =>
  raw.includes('%')
    ? raw.replace(/(?:%[0-9a-f]{2})+/gi, run => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    })
    : raw;

/**
 * Whether a note that stays where it is can hold a link to `source` or a file under it: such a link names `source` by
 * its last path segment, plainly or percent-escaped, or spells a raw-file query, where `+` stands for a space.
 */
export function mayLinkToMove(raw: string, source: string) {
  const name = source.slice(source.lastIndexOf('/') + 1);
  return Boolean(name) && (raw.includes(name) || raw.includes('/api/files/raw?') || unescaped(raw).includes(name));
}

/**
 * The snapshot's `files`, read a batch at a time: each batch is prefetched in one go, so a large workspace costs a few
 * round trips, and only one batch is held before the caller keeps or drops each file.
 */
export async function* snapshotFileBatches(reader: RemoteSource, snapshot: RemoteSnapshot, files: string[], batchBytes = 16 * 1024 * 1024): AsyncGenerator<[string, Buffer]> {
  const sizes = new Map(snapshot.entries.map(entry => [entry.path, entry.size || 0]));
  for (let start = 0; start < files.length;) {
    let end = start, bytes = 0;
    while (end < files.length && (end === start || bytes + (sizes.get(files[end]) ?? 0) <= batchBytes)) bytes += sizes.get(files[end++]) ?? 0;
    const batch = files.slice(start, end);
    await reader.prefetchFiles(batch);
    for (const file of batch) yield [file, await reader.readSnapshotFile(snapshot, file)];
    start = end;
  }
}
