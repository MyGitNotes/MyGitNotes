import { closestCenter, type CollisionDetection, type KeyboardCoordinateGetter, pointerWithin } from '@dnd-kit/core';
import { type CompilationItem, isFileItem } from '@mygitnotes/core/compilation';

/** The derived folder headings are separators, not drop targets. Members can only drop within their own chapter. */
export function dragChapters(items: readonly CompilationItem[], grouped: boolean): Map<string, string> {
  const chapters = new Map<string, string>();
  if (!grouped) return chapters;
  let chapter = '';
  for (const item of items) {
    if (item.kind === 'heading') chapter = item.id;
    else chapters.set(item.id, chapter);
  }
  return chapters;
}

/** Move relative to the target in the complete order, not the (possibly paged) list visible during the drag. */
export function dynamicOrderAfterDrop(items: readonly CompilationItem[], grouped: boolean, active: string, over: string): string[] | undefined {
  const members = items.filter(isFileItem);
  const from = members.findIndex(item => item.id === active), to = members.findIndex(item => item.id === over);
  if (from < 0 || to < 0 || from === to) return;
  const chapters = dragChapters(items, grouped);
  if (chapters.get(active) !== chapters.get(over)) return;
  const [moved] = members.splice(from, 1);
  members.splice(to, 0, moved);
  return members.map(item => item.path);
}

/** Empty custom lanes participate in keyboard movement. Folder-grouped members target only their chapter. */
export const screenKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) || !context.collisionRect) return;
  event.preventDefault();
  const current = context.collisionRect;
  const x = current.left + current.width / 2, y = current.top + current.height / 2;
  const candidates = context.droppableContainers.getEnabled().flatMap(container => {
    if (container.id === context.active?.id || container.data.current?.chapterId !== context.active?.data.current?.chapterId) return [];
    if (String(container.id).startsWith('lane:') && !container.data.current?.empty) return [];
    const rect = context.droppableRects.get(container.id);
    if (!rect) return [];
    const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
    const vertical = ['ArrowUp', 'ArrowDown'].includes(event.code);
    const forward = event.code === 'ArrowDown' ? dy > 5 : event.code === 'ArrowUp' ? dy < -5 : event.code === 'ArrowRight' ? dx > 5 && Math.abs(dy) < current.height / 2 : dx < -5 && Math.abs(dy) < current.height / 2;
    return forward ? [{ rect, distance: vertical ? Math.abs(dy) * 3 + Math.abs(dx) : Math.abs(dx) }] : [];
  }).sort((a, b) => a.distance - b.distance);
  const target = candidates[0]?.rect;
  return target ? { x: currentCoordinates.x + target.left + target.width / 2 - x, y: currentCoordinates.y + target.top + target.height / 2 - y } : undefined;
};

export const screenCollision: CollisionDetection = args => {
  const candidates = { ...args, droppableContainers: args.droppableContainers.filter(container => container.data.current?.chapterId === args.active.data.current?.chapterId) };
  if (!args.pointerCoordinates) return closestCenter({ ...candidates, droppableContainers: candidates.droppableContainers.filter(container => !String(container.id).startsWith('lane:') || container.data.current?.empty) });
  const hits = pointerWithin(candidates);
  const cards = hits.filter(hit => !String(hit.id).startsWith('lane:'));
  return cards.length ? cards : hits;
};
