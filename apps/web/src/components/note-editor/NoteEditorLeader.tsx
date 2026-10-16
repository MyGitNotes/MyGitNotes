import { useTranslation } from '../../lib/i18n/index.js';
import { formatKeys } from '../../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../../lib/keyboard/keymap.js';
import { keyEnvironment } from '../../lib/keyboard/platform.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';

/** The keyboard leader menu: the next key opens find, or for a Markdown note its outline or the other editor mode. */
export function NoteEditorLeader({ docPanel, isMarkdown }: { docPanel: NoteDocumentPanelState; isMarkdown: boolean; }) {
  const { t } = useTranslation();
  const leader = bindingsFor(keymapEntry('editor.leader'), keyEnvironment).map(keys => formatKeys(keys, keyEnvironment).join(' ')).join(' / ');
  return (
    <div className='note-editor-leader' role='dialog' aria-modal='false' aria-label={t('editor.noteCommands')}>
      <div>
        <strong>{t('editor.noteCommands')}</strong>
        <small>{t('editor.leaderHint', { keys: leader })}</small>
      </div>
      <button type='button' onClick={docPanel.openFind}>
        <kbd>F</kbd>
        <span>{t('editor.findInNote')}</span>
      </button>
      {isMarkdown && (
        <button type='button' onClick={docPanel.openOutline}>
          <kbd>/</kbd>
          <span>{t('editor.outline')}</span>
        </button>
      )}
      {isMarkdown && (
        <button type='button' onClick={docPanel.toggleEditorMode}>
          <kbd>M</kbd>
          <span>{t('command.editor.leaderMode')}</span>
        </button>
      )}
    </div>
  );
}
