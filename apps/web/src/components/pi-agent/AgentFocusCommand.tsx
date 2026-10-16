import { useRegisterCommands } from '../../lib/commands/registry.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { assistantDock } from '../../lib/assistant-dock.js';
import { requestAgentInputFocus } from '../../lib/pi-agent/input-focus.js';
import { usePiAgent } from '../../lib/pi-agent/session.js';
import { usePhone } from '../../lib/use-phone.js';

/**
 * The key that moves between the agent and the note. From the agent it returns to the editor the agent names, where its
 * caret was, or closes the dock where no editor is open, so the key still toggles on a list; from anywhere else it opens
 * the assistant dock and focuses its message box, starting Pi first when none runs: the box appears only once a
 * session's history has. On a phone the dock is a sheet over the page, so it closes as it hands the caret back. Rendered
 * inside the PiAgentProvider.
 */
export function AgentFocusCommand() {
  const { t } = useTranslation();
  const { available, target, session, starting, start, wake } = usePiAgent();
  const phone = usePhone();
  useRegisterCommands([{
    id: 'assistant.toggleFocus',
    availability: () => available ? { enabled: true } : { enabled: false, reason: t('shortcuts.requiresAgent') },
    run: ({ previousFocus }) => {
      if (previousFocus?.closest('.pi-agent-panel')) {
        if (target?.focusEditor) {
          if (phone) assistantDock.close();
          target.focusEditor();
        } else assistantDock.close();
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
