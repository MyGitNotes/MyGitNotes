import { useRegisterCommands } from '../../lib/commands/registry.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { usePanelContext } from '../../lib/panel-context.js';
import { requestAgentInputFocus } from '../../lib/pi-agent/input-focus.js';
import { usePiAgent } from '../../lib/pi-agent/session.js';

/**
 * The key that moves between the agent and the note. From the agent it returns to the editor the agent names, where its
 * caret was; from anywhere else it opens the agent, in that editor's document panel or else in the tools panel, and
 * focuses its message box. Rendered inside the PiAgentProvider.
 */
export function AgentFocusCommand() {
  const { t } = useTranslation();
  const { available, target } = usePiAgent();
  const { openTool } = usePanelContext();
  useRegisterCommands([{
    id: 'assistant.toggleFocus',
    availability: () => available ? { enabled: true } : { enabled: false, reason: t('shortcuts.requiresAgent') },
    run: ({ previousFocus }) => {
      if (previousFocus?.closest('.pi-agent-panel')) {
        target?.focusEditor?.();
        return;
      }
      if (target?.openAgent) target.openAgent();
      else openTool('agent');
      requestAgentInputFocus();
    },
  }]);
  return null;
}
