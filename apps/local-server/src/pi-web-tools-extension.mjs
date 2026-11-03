// Loaded into the bridged Pi with `--extension` when its agent edits a remote workspace from the web panel.
// Each tool is answered by the page that holds the panel, through the bridge: a write becomes one of that page's
// working changes, and nothing is committed until the person commits it. The bridge names its endpoint and the
// session's token in the environment it starts Pi with, and the agent workspace the session runs in.
import { Type } from 'typebox';

const target = { notebookId: Type.Optional(Type.String({ description: 'The notebook, to tell two repositories with the same path apart.' })) };
const AGENT_TOOLS = new Set(['agent_system', 'read_agent_file']);
const TOOLS = [{ name: 'mygitnotes_read_note', label: 'Read note', description: 'Read a note as the person sees it: their working change when there is one (source: working), else the committed note (source: committed). Paths are repository-relative, such as notes/plan.md.', parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_write_note', label: 'Write note', description: "Create a note or replace its body and frontmatter, as a working change in the person's browser. Nothing is committed; the person reviews and commits it.", parameters: Type.Object({ path: Type.String(), content: Type.String({ description: 'The Markdown body, without frontmatter.' }), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Frontmatter; keys left out keep their values.' })), ...target }) }, { name: 'mygitnotes_edit_note', label: 'Edit note', description: 'Replace one exact, unique occurrence of oldText in the note body with newText, as a working change. Read the note first.', parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String(), ...target }) }, { name: 'mygitnotes_delete_note', label: 'Delete note', description: "Delete a note as a working change: it moves to the person's uncommitted trash, where they can restore it, and goes only when they commit.", parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_agent_system', label: 'Agent system', description: "The instructions and skills that govern a note or folder: the AGENTS.md of every agent folder from the repository root down to it (root first, with contents) and the skills of those folders (name, description, SKILL.md path, directory), the nearest folder winning a shared skill name. Pass a note or folder path (repository-relative), or a notebookId alone for a notebook's root; with neither, it answers for the agent workspace this session runs in. Read a skill's files with mygitnotes_read_agent_file.", parameters: Type.Object({ path: Type.Optional(Type.String({ description: 'A note or folder path, such as blog/posts/plan.md.' })), ...target }) }, { name: 'mygitnotes_read_agent_file', label: 'Read agent file', description: "Read the text of an AGENTS.md or a skill file (SKILL.md, a reference or a script under .agents/skills/<name>/) of the workspace. Any other path is refused. Name the notebookId when the file belongs to a notebook other than this session's agent workspace.", parameters: Type.Object({ path: Type.String({ description: 'Repository-relative, such as blog/.agents/skills/post/SKILL.md.' }), ...target }) }, { name: 'mygitnotes_list_changes', label: 'List changes', description: "List the person's working changes (added, modified, deleted), with a unified diff of each.", parameters: Type.Object({}) }];

/** How long the page gets to answer the agent system the run starts with. */
const AUTOLOAD_TIMEOUT_MS = 20_000;

/** The system prompt addition for the agent system the page answered: its instructions, and the skills on offer. */
export function formatAgentSystem({ workspace, files = [], skills = [] }) {
  if (!files.length && !skills.length) return '';
  const where = workspace?.folder ? `${workspace.folder} of ${workspace.repository}` : `the root of ${workspace?.repository ?? 'the repository'}`;
  const parts = [`# Agent system of this workspace (${where})`, "Your working directory is empty; these are the instructions and skills of the workspace's repository, read for you. Follow the instructions."];
  for (const file of files) parts.push(`## ${file.path}\n${String(file.content).trimEnd()}`);
  if (skills.length) parts.push(`## Skills\nLoad a skill by reading its SKILL.md with mygitnotes_read_agent_file, then the files it names.\n${skills.map(skill => `- ${skill.name}: ${skill.description || '(no description)'} (${skill.path})`).join('\n')}`);
  return `\n\n${parts.join('\n\n')}`;
}

export default function webTools(pi) {
  const url = process.env.MYGITNOTES_WEB_TOOLS_URL, token = process.env.MYGITNOTES_WEB_TOOLS_TOKEN;
  if (!url || !token) return;
  const repository = process.env.MYGITNOTES_AGENT_REPOSITORY;
  // The agent workspace is fixed for the process: a location change restarts Pi.
  const workspace = repository ? { repository, folder: process.env.MYGITNOTES_AGENT_FOLDER ?? '' } : undefined;
  async function call(name, params, signal) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ tool: name, arguments: AGENT_TOOLS.has(name) && workspace ? { ...params, workspace } : params }), signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `The note tool failed (${res.status}).`);
    return body.result;
  }
  for (const tool of TOOLS) {
    pi.registerTool({
      ...tool,
      async execute(_toolCallId, params, signal) {
        const result = await call(tool.name.replace(/^mygitnotes_/, ''), params, signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      },
    });
  }
  // The session workspace's agent system joins the system prompt, as Pi's own context files would in a local checkout.
  // It is kept once read, so every run of this process sends the same text; a failed read is tried again at the next run.
  let loaded;
  pi.on('before_agent_start', async event => {
    if (!workspace) return undefined;
    try {
      loaded ??= formatAgentSystem(await call('agent_system', {}, AbortSignal.timeout(AUTOLOAD_TIMEOUT_MS)));
    } catch {
      return undefined;
    }
    return loaded ? { systemPrompt: event.systemPrompt + loaded } : undefined;
  });
}
