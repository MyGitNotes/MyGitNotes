/** The agent system a page answered for `agent_system`: the workspace it describes, its instructions and skills. */
export interface AgentSystemResult {
  workspace?: { repository: string; folder: string; };
  files?: { path: string; content: string; }[];
  skills?: { name: string; description?: string; path: string; directory?: string; }[];
}

/** The text appended to Pi's system prompt for an agent system, or an empty string when it has no instructions or skills. */
export function formatAgentSystem(result: AgentSystemResult): string;

/** The subset of Pi's extension API this extension uses. */
interface PiExtensionApi {
  registerTool(tool: { name: string; execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>; [key: string]: unknown; }): void;
  on(event: 'before_agent_start', handler: (event: { systemPrompt: string; }) => Promise<{ systemPrompt: string; } | undefined>): void;
}

export default function webTools(pi: PiExtensionApi): void;
