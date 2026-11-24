import type { ReactNode, Ref } from 'react';
import { LogIn } from 'lucide-react';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { primaryShortcutHint } from '../../lib/keyboard/keymap.js';
import { Button } from '../Button.js';
import { Tooltip } from '../Tooltip.js';
import './live-editor.css';

/** A person editing the note, under the name and colour their cursor shows. */
export interface LiveEditorPerson {
  name: string;
  color: string;
}

export interface LiveToolbarState {
  status?: { people: number; state: 'live.connecting' | 'live.saved' | 'live.saving' | 'live.unsaved' | 'live.offline' | 'live.disconnected'; you?: LiveEditorPerson; others?: readonly LiveEditorPerson[]; };
  checkIn?: { run: () => void; disabled: boolean; };
  discard?: { run: () => void; disabled?: boolean; reason?: TranslationKey; };
  openInTab?: string;
}

export type RenderLiveToolbar = (state: LiveToolbarState) => ReactNode;

/** Lets an editor supply actions without reading their imperative refs during its render. */
export function LiveToolbarSlot({ render, state }: { render: RenderLiveToolbar; state: LiveToolbarState; }) {
  return render(state);
}

export function LiveCheckIn({ action, buttonRef, iconOnly = false }: { action: LiveToolbarState['checkIn']; buttonRef?: Ref<HTMLButtonElement>; iconOnly?: boolean; }) {
  const { t } = useTranslation();
  if (!action) return null;
  return (
    <Tooltip label={t('live.checkInHint')} detail={primaryShortcutHint('editor.commit')}>
      <Button ref={buttonRef} size={iconOnly ? 'icon' : 'small'} variant='primary' aria-label={t('live.checkIn')} disabled={action.disabled} onClick={action.run}>{iconOnly ? <LogIn aria-hidden='true' /> : t('live.checkIn')}</Button>
    </Tooltip>
  );
}

function EditorList({ you, others = [] }: { you?: LiveEditorPerson; others?: readonly LiveEditorPerson[]; }) {
  const { t } = useTranslation();
  const people = [...(you ? [{ ...you, own: true }] : []), ...others.filter(person => person.name !== you?.name).map(person => ({ ...person, own: false }))];
  if (!people.length) return null;
  return (
    <span role='list' className='live-editor-people' aria-label={t('live.editorList')}>
      {people.map(person => (
        <span role='listitem' key={person.name} className='live-editor-person'>
          <span className='live-editor-swatch' style={person.color ? { backgroundColor: person.color } : undefined} aria-hidden='true' />
          {person.own ? t('live.editorYou', { name: person.name }) : person.name}
        </span>
      ))}
    </span>
  );
}

export function LiveStatusBadge({ status }: { status: LiveToolbarState['status']; }) {
  const { t } = useTranslation();
  if (!status) return null;
  const { state, people, you, others } = status;
  const listed = Boolean(you || others?.length);
  return (
    <Tooltip label={t(listed ? 'live.editorList' : 'live.editor')} detail={listed ? <EditorList you={you} others={others} /> : undefined}>
      <span className='live-toolbar-badge' tabIndex={0} data-tone={state === 'live.saved' ? 'ok' : state === 'live.offline' || state === 'live.disconnected' ? 'warn' : undefined}>
        <span className='live-toolbar-dot' aria-hidden='true' />
        <span>
          {'Live · '}
          <span>{t('live.editors', { count: people })}</span>
        </span>
        <span className='live-toolbar-divider' aria-hidden='true'>{' · '}</span>
        <span className='live-toolbar-state'>{t(state)}</span>
      </span>
    </Tooltip>
  );
}
