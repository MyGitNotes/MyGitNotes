import { Bot } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { useAssistantDock } from '../../lib/assistant-dock.js';
import { usePiAgentAvailable } from '../../lib/pi-agent/session.js';

/** The button that opens and closes the assistant dock; nothing where the dock is not offered. */
export function AssistantDockToggle({ className = '', disabled }: { className?: string; disabled?: boolean; }) {
  const { t } = useTranslation();
  const available = usePiAgentAvailable();
  const { open, toggleDock } = useAssistantDock();
  if (!available) return null;
  return (
    <button type='button' disabled={disabled} className={`ui-icon-button assistant-dock-toggle ${className}`} aria-label={t('piAgent.tab')} title={t('piAgent.tab')} aria-expanded={open} aria-controls='assistant-dock' data-open={open || undefined} onClick={toggleDock}>
      <Bot aria-hidden='true' />
    </button>
  );
}
