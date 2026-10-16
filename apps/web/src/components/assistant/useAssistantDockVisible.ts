import { useAssistantDock } from '../../lib/assistant-dock.js';
import { usePiAgentAvailable } from '../../lib/pi-agent/session.js';

/** Whether the dock is on screen: opened, and offered at all (a computer without Pi, or an edition without the agent, never shows it). */
export function useAssistantDockVisible(): boolean {
  const available = usePiAgentAvailable();
  const { open } = useAssistantDock();
  return available && open;
}
