/** A name as a case-insensitive file system compares it: APFS and NTFS ignore letter case, and APFS Unicode normalization too. */
export const foldName = (file: string) => file.normalize('NFC').toLowerCase();

/**
 * Whether `target` names the same entry as one of `paths` on a case-insensitive file system (macOS, Windows), other than
 * itself and the entries `skip` accepts. Writing there would overwrite that entry, and a move would then delete it.
 */
export function differsOnlyInCase(paths: Iterable<string>, target: string, skip: (file: string) => boolean = () => false): boolean {
  const folded = foldName(target);
  for (const file of paths) if (file !== target && !skip(file) && foldName(file) === folded) return true;
  return false;
}
export function foldedIndex(paths: string[]) {
  const index = new Map<string, string[]>();
  for (const file of paths) {
    const key = foldName(file);
    index.set(key, [...index.get(key) ?? [], file]);
  }
  return index;
}
export const CASE_COLLISION_ERROR = 'Another file or folder has this name in different letter case; choose a different name.';
