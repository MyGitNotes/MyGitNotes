import { useRegisterCommands } from '../../lib/commands/registry.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { assistantDock } from '../../lib/assistant-dock.js';
import { requestAgentInputFocus } from '../../lib/pi-agent/input-focus.js';
import { usePiAgent } from '../../lib/pi-agent/session.js';

/**
 * The key that moves between the agent and the note. From the agent it returns to the editor the agent names, where its
 * caret was; from anywhere else it opens the assistant dock and focuses its message box, starting Pi first when none
 * runs: the box appears only once a session's history has. Rendered inside the PiAgentProvider.
 */
export function AgentFocusCommand() {
  const { t } = useTranslation();
  const { available, target, session, starting, start, wake } = usePiAgent();
  useRegisterCommands([{
    id: 'assistant.toggleFocus',
    availability: () => available ? { enabled: true } : { enabled: false, reason: t('shortcuts.requiresAgent') },
    run: ({ previousFocus }) => {
      if (previousFocus?.closest('.pi-agent-panel')) {
        target?.focusEditor?.();
        return;
      }
      assistantDock.open();
      requestAgentInputFocus();
      // Pressing the key is asking for the agent, so a session that ended is started again too, which focus alone never does.
      if (session?.status === 'exited' && !starting) void start();
      else wake();
    },
  }]);
  return null;
}
