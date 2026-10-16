import { Bot } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { useAssistantDock } from '../../lib/assistant-dock.js';
import { ariaKeyShortcuts, formatKeys } from '../../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../../lib/keyboard/keymap.js';
import { keyEnvironment } from '../../lib/keyboard/platform.js';
import { usePiAgentAvailable } from '../../lib/pi-agent/session.js';

/** The button that opens and closes the assistant dock; nothing where the dock is not offered. Its tooltip names the key that opens it too. */
export function AssistantDockToggle({ className = '', disabled }: { className?: string; disabled?: boolean; }) {
  const { t } = useTranslation();
  const available = usePiAgentAvailable();
  const { open, toggleDock } = useAssistantDock();
  if (!available) return null;
  const [keys] = bindingsFor(keymapEntry('assistant.toggleFocus'), keyEnvironment);
  const label = t('piAgent.tab');
  return (
    <button type='button' disabled={disabled} className={`ui-icon-button assistant-dock-toggle ${className}`} aria-label={label} title={keys ? `${label} (${formatKeys(keys, keyEnvironment).join(' ')})` : label} aria-keyshortcuts={keys && ariaKeyShortcuts(keys, keyEnvironment)} aria-expanded={open} aria-controls='assistant-dock' data-open={open || undefined} onClick={toggleDock}>
      <Bot aria-hidden='true' />
    </button>
  );
}
