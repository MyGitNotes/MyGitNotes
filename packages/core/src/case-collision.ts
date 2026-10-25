/**
 * Whether `target` names the same entry as one of `paths` on a case-insensitive file system (macOS, Windows), other than
 * itself and the entries `skip` accepts. Writing there would overwrite that entry, and a move would then delete it.
 */
export function differsOnlyInCase(paths: Iterable<string>, target: string, skip: (file: string) => boolean = () => false): boolean {
  const folded = target.toLowerCase();
  for (const file of paths) if (file !== target && !skip(file) && file.toLowerCase() === folded) return true;
  return false;
}
export function foldedIndex(paths: string[]) {
  const index = new Map<string, string[]>();
  for (const file of paths) {
    const key = file.toLowerCase();
    index.set(key, [...index.get(key) ?? [], file]);
  }
  return index;
}
export const CASE_COLLISION_ERROR = 'Another file or folder has this name in different letter case; choose a different name.';
