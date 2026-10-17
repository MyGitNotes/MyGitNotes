import { ChevronRight, Folder } from 'lucide-react';
import type { NoteGroup } from '../lib/note-groups.js';
import { useTranslation } from '../lib/i18n/index.js';

/** A folder's heading in a list grouped by folder; clicking it collapses or expands the folder's notes. */
export function NoteGroupHeading({ group, collapsed, onToggle }: { group: NoteGroup; collapsed: boolean; onToggle?: (key: string) => void; }) {
  const { t } = useTranslation();
  if (!onToggle) {
    return (
      <div className='note-group-heading'>
        <Folder aria-hidden='true' />
        <span>{group.label}</span>
      </div>
    );
  }
  return (
    <button type='button' className='note-group-heading note-group-toggle' aria-expanded={!collapsed} title={t(collapsed ? 'folder.expand' : 'folder.collapse')} onClick={() => onToggle(group.key)}>
      <ChevronRight className='note-group-chevron' aria-hidden='true' />
      <Folder aria-hidden='true' />
      <span>{group.label}</span>
    </button>
  );
}
