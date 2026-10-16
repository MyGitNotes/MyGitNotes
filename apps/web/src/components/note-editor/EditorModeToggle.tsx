import { Code2, Eye } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { formatKeys } from '../../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../../lib/keyboard/keymap.js';
import { keyEnvironment } from '../../lib/keyboard/platform.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';

interface EditorModeToggleProps {
  mode: MarkdownEditorMode;
  onChange: (mode: MarkdownEditorMode) => void;
  className: string;
  iconSize?: number;
  /** Where the note leader answers (zoom and Focus panes), the tooltip names its key for the same switch. */
  showKey?: boolean;
}

/** One button between live preview and source: its icon is the mode shown now, its name the mode it switches to. */
export function EditorModeToggle({ mode, onChange, className, iconSize, showKey = false }: EditorModeToggleProps) {
  const { t } = useTranslation();
  const live = mode === 'live';
  const label = t(live ? 'editor.switchToSource' : 'editor.switchToLive');
  const [keys] = showKey ? bindingsFor(keymapEntry('editor.leaderMode'), keyEnvironment) : [];
  return <button type='button' className={className} data-mode-toggle={mode} aria-label={label} title={keys ? `${label} (${formatKeys(keys, keyEnvironment).join(' ')})` : label} onClick={() => onChange(live ? 'raw' : 'live')}>{live ? <Eye size={iconSize} aria-hidden='true' /> : <Code2 size={iconSize} aria-hidden='true' />}</button>;
}
