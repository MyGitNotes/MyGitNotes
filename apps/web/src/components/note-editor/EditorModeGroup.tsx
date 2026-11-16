import { Code2, Columns2, Eye, type LucideIcon } from 'lucide-react';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { formatKeys } from '../../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../../lib/keyboard/keymap.js';
import { keyEnvironment } from '../../lib/keyboard/platform.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';

const MODES: Record<MarkdownEditorMode, { label: TranslationKey; icon: LucideIcon; }> = { live: { label: 'editor.livePreview', icon: Eye }, raw: { label: 'editor.source', icon: Code2 }, split: { label: 'editor.split', icon: Columns2 } };

interface EditorModeGroupProps {
  mode: MarkdownEditorMode;
  /** The modes offered, in order. */
  modes: readonly MarkdownEditorMode[];
  onChange: (mode: MarkdownEditorMode) => void;
}

/**
 * The editor's mode in the head toolbar: one icon button per mode offered, the one in use pressed. Live and source name the
 * note leader's key, which switches between the two.
 */
export function EditorModeGroup({ mode, modes, onChange }: EditorModeGroupProps) {
  const { t } = useTranslation();
  const [keys] = bindingsFor(keymapEntry('editor.leaderMode'), keyEnvironment);
  const key = keys ? ` (${formatKeys(keys, keyEnvironment).join(' ')})` : '';
  return (
    <div role='group' className='note-mode-group' aria-label={t('editor.modes')}>
      {modes.map(value => {
        const { label, icon: Icon } = MODES[value];
        const name = t(label) + (value === 'split' ? '' : key);
        return (
          <button key={value} type='button' className='ui-icon-button toolbar-icon-button editor-mode-action' data-mode={value} aria-pressed={mode === value} aria-label={name} title={name} onClick={() => onChange(value)}>
            <Icon aria-hidden='true' />
          </button>
        );
      })}
    </div>
  );
}
