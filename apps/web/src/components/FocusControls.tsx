import React, { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Columns2, ListTree, PanelsTopLeft, Rows2, X } from 'lucide-react';
import { FocusError } from '@mygitnotes/core/focus-page';
import { CURRENT_FOCUS } from '../lib/focus-view.js';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { focusErrorMessage } from '../lib/focus-error-message.js';
import { useTranslation } from '../lib/i18n/index.js';
import { LoadingStatus } from './LoadingStatus.js';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { LayoutIcon } from './FocusLayoutIcon.js';
import { dropRefusal } from '../lib/focus-drop.js';
import { SelectButtonGroup, SelectButtonPrimary, SelectButtonTrigger } from './SelectButton.js';

type Dialog = { kind: 'name'; } | { kind: 'rename'; id: string; name: string; } | { kind: 'delete'; id: string; name: string; };

/** The Notes toolbar's Focus switcher and Layout menu, with naming, renaming and deleting. */
export const FocusControls: React.FC<{
  focus: NoteFocus;
  /** Shows a Focus (`current` or an id), or returns to normal browsing with null. */
  onShow: (key: string | null) => void;
  onReload: () => void;
  /** Phones show the browse region or the Focus, one at a time. */
  browseToggle?: { showing: boolean; onToggle: () => void; };
  /** Whether the whole split tree is on screen (desktop), the only case a pane can be split. */
  splittable: boolean;
}> = ({ focus, onShow, onReload, browseToggle, splittable }) => {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const named = focus.shown && focus.shown !== CURRENT_FOCUS ? focus.focuses.find(item => item.id === focus.shown) : undefined;
  const label = named ? named.name : focus.shown ? t('focus.current') : t('focus.title');
  const taken = focus.focuses.map(item => item.name);

  return (
    <>
      {/* A split button: the main part opens the Scratch (or leaves the shown Focus), the chevron lists every Focus. */}
      <SelectButtonGroup className='focus-switcher' active={Boolean(focus.shown)}>
        <SelectButtonPrimary title={t(focus.shown ? 'focus.close' : 'focus.openCurrent')} onClick={() => onShow(focus.shown ? null : CURRENT_FOCUS)}>
          <PanelsTopLeft aria-hidden='true' />
          <span>{label}</span>
        </SelectButtonPrimary>
        <DropdownMenu.Root>
          <SelectButtonTrigger aria-label={t('focus.switch')} title={t('focus.switch')}>
            <ChevronDown aria-hidden='true' />
          </SelectButtonTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('focus.switch')} onEscapeKeyDown={event => event.stopPropagation()}>
              <DropdownMenu.RadioGroup value={focus.shown ?? ''} onValueChange={onShow}>
                <DropdownMenu.RadioItem value={CURRENT_FOCUS}>{t('focus.current')}</DropdownMenu.RadioItem>
                {focus.focuses.map(item => (
                  <DropdownMenu.RadioItem key={item.id} value={item.id}>
                    <LayoutIcon layout={item} />
                    <span>{item.name}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              {focus.loading && <LoadingStatus>{t('focus.loading')}</LoadingStatus>}
              {focus.error && (
                <>
                  <p role='alert'>{focus.error}</p>
                  <DropdownMenu.Item onSelect={onReload}>{t('focus.reload')}</DropdownMenu.Item>
                </>
              )}
              {focus.shown && <DropdownMenu.Separator />}
              {focus.shown === CURRENT_FOCUS && focus.canName && <DropdownMenu.Item onSelect={() => setDialog({ kind: 'name' })}>{t('focus.name')}</DropdownMenu.Item>}
              {named && focus.editableFocus(named.id) && (
                <>
                  <DropdownMenu.Item onSelect={() => setDialog({ kind: 'rename', id: named.id, name: named.name })}>{t('focus.rename')}</DropdownMenu.Item>
                  <DropdownMenu.Item className='focus-menu-danger' onSelect={() => setDialog({ kind: 'delete', id: named.id, name: named.name })}>{t('focus.delete')}</DropdownMenu.Item>
                </>
              )}
              {focus.shown && <DropdownMenu.Item onSelect={() => onShow(null)}>{t('focus.close')}</DropdownMenu.Item>}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </SelectButtonGroup>
      {focus.mutationError && (
        <p role='alert' className='focus-mutation-error' title={focusErrorMessage(t, focus.mutationError)}>
          <span>{focusErrorMessage(t, focus.mutationError)}</span>
          <button type='button' className='ui-icon-button' aria-label={t('focus.dismissError')} title={t('focus.dismissError')} onClick={focus.dismissMutationError}>
            <X aria-hidden='true' />
          </button>
        </p>
      )}
      {focus.layout && focus.entry && <LayoutMenu focus={focus} splittable={splittable} />}
      {focus.layout && browseToggle && <button type='button' className='ui-icon-button' aria-pressed={browseToggle.showing} onClick={browseToggle.onToggle} aria-label={t(browseToggle.showing ? 'focus.showFocus' : 'focus.showBrowse')} title={t(browseToggle.showing ? 'focus.showFocus' : 'focus.showBrowse')}>{browseToggle.showing ? <PanelsTopLeft aria-hidden='true' /> : <ListTree aria-hidden='true' />}</button>}
      {dialog?.kind === 'name' && <FocusNameDialog title={t('focus.nameTitle')} initial='' taken={taken} onClose={() => setDialog(null)} onSubmit={name => onShow(focus.name(name))} />}
      {dialog?.kind === 'rename' && <FocusNameDialog title={t('focus.renameTitle')} initial={dialog.name} taken={taken.filter(name => name !== dialog.name)} onClose={() => setDialog(null)} onSubmit={name => focus.rename(dialog.id, name)} />}
      {dialog?.kind === 'delete' && (
        <WorkspaceDialog title={t('focus.deleteTitle')} onClose={() => setDialog(null)}>
          <p>{t('focus.deleteHint', { name: dialog.name })}</p>
          <div className='workspace-dialog-actions'>
            <Button type='button' onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button
              type='button'
              variant='danger'
              onClick={async () => {
                if (!await focus.remove(dialog.id)) return;
                setDialog(null);
                if (focus.shown === dialog.id) onShow(null);
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </>
  );
};

/** Splits the active pane or folds every pane into one. A split is offered where the whole tree is on screen, the active pane shows a note and no limit would refuse it. */
const LayoutMenu: React.FC<{ focus: NoteFocus; splittable: boolean; }> = ({ focus, splittable }) => {
  const { t } = useTranslation();
  const layout = focus.layout!, pane = focus.entry!.activePane;
  const shows = Boolean(focus.entry!.shown[pane]);
  const fail = () => {};
  const splitItem = (edge: 'right' | 'bottom', orientation: 'horizontal' | 'vertical', label: string, icon: React.ReactNode) => {
    const refusal = splittable && shows ? dropRefusal(layout, pane, edge) : undefined;
    const reason = refusal ? t(refusal === 'pane-limit' ? 'focus.paneLimit' : refusal === 'depth-limit' ? 'focus.depthLimit' : 'focus.limit') : undefined;
    return (
      <DropdownMenu.Item disabled={!focus.editable || !splittable || !shows || Boolean(refusal)} title={reason} onSelect={() => void focus.splitShown(pane, orientation).catch(fail)}>
        {icon}
        <span>{label}</span>
      </DropdownMenu.Item>
    );
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className='ui-icon-button focus-layout-trigger' disabled={!focus.editable} aria-label={t('focus.layout')} title={t('focus.layout')}>
        <LayoutIcon layout={layout} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('focus.layout')} onEscapeKeyDown={event => event.stopPropagation()}>
          {splitItem('right', 'horizontal', t('focus.splitRight'), <Columns2 aria-hidden='true' />)}
          {splitItem('bottom', 'vertical', t('focus.splitDown'), <Rows2 aria-hidden='true' />)}
          <DropdownMenu.Item disabled={layout.root.kind === 'pane'} onSelect={() => void focus.mergeAll().catch(fail)}>
            <LayoutIcon layout={{ root: { kind: 'pane', id: 'merged', tabs: [] } }} />
            <span>{t('focus.mergePanes')}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

/** Names or renames a Focus; a name already used in this notebook is flagged before submitting. */
const FocusNameDialog: React.FC<{ title: string; initial: string; taken: string[]; onSubmit: (name: string) => void; onClose: () => void; }> = ({ title, initial, taken, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const duplicate = taken.includes(trimmed);
  return (
    <WorkspaceDialog title={title} onClose={onClose}>
      <form
        className='screen-form'
        onSubmit={event => {
          event.preventDefault();
          if (!trimmed || duplicate) return;
          try {
            onSubmit(trimmed);
            onClose();
          } catch (caught) {
            setError(caught instanceof FocusError && caught.code === 'duplicate-name' ? t('focus.duplicateName') : (caught as Error).message);
          }
        }}
      >
        <label>
          {t('focus.nameLabel')}
          <input
            className='ui-control'
            value={name}
            maxLength={100}
            required
            autoFocus
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate || error ? 'focus-name-error' : undefined}
            onChange={event => {
              setName(event.target.value);
              setError('');
            }}
          />
        </label>
        {(duplicate || error) && <p id='focus-name-error' role='alert' className='focus-name-error'>{duplicate ? t('focus.duplicateName') : error}</p>}
        <div className='workspace-dialog-actions'>
          <Button type='button' onClick={onClose}>{t('common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={!trimmed || duplicate}>{t('common.save')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
};
