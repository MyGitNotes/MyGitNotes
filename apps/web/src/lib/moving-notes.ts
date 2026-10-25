/** How long a moved note's old path keeps being treated as moved, so an editor still open on it is gone before it can read the path as deleted. */
const GRACE_MS = 15000;

const moving = new Map<string, number>();

/**
 * Marks the note `key` as being moved. While it is marked, an editor open on that path that finds the file gone knows
 * it was moved by this page and does not report a conflict. The returned function ends the mark: at once when the
 * move failed, after a grace period when it went through.
 */
export function beginNoteMove(key: string): (moved: boolean) => void {
  moving.set(key, (moving.get(key) ?? 0) + 1);
  return moved => {
    const release = () => {
      const count = (moving.get(key) ?? 1) - 1;
      if (count > 0) moving.set(key, count);
      else moving.delete(key);
    };
    if (moved) setTimeout(release, GRACE_MS);
    else release();
  };
}

/** Whether this page is moving, or just moved, the note `key`. */
export const isNoteMoving = (key: string) => moving.has(key);
