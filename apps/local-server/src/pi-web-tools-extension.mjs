// Loaded into the bridged Pi with `--extension` when its agent edits a remote workspace from the web panel.
// Each tool is answered by the page that holds the panel, through the bridge: a write becomes one of that page's
// working changes, and nothing is committed until the person commits it. The bridge names its endpoint and the
// session's token in the environment it starts Pi with, and the agent workspace the session runs in.
import { Type } from 'typebox';

const target = { notebookId: Type.Optional(Type.String({ description: 'The notebook, to tell two repositories with the same path apart.' })) };
const AGENT_TOOLS = new Set(['agent_system', 'read_agent_file']);
// The product's rule about note templates, as the MCP tools say it to a connector.
// Writes are refused by the page for any note but the one open in the person's editor and those they marked editable.
const SCOPE_GUIDANCE = "The page refuses it unless the note is the one open in the person's editor or one the person marked editable for you; then propose the change as text in your reply instead.";
const TEMPLATE_GUIDANCE = "Before creating a note, call mygitnotes_list_templates with a query for the kind of note. When a template fits, ask the person whether to use it, then create the note with mygitnotes_write_note's template and values, filling every declared placeholder you can. A notebook's AGENTS.md may say otherwise.";
const TOOLS = [{ name: 'mygitnotes_read_note', label: 'Read note', description: 'Read a note as the person sees it: their working change when there is one (source: working), else the committed note (source: committed). Paths are repository-relative, such as notes/plan.md.', parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_write_note', label: 'Write note', description: `Create a note or replace its body and frontmatter, as a working change in the person's browser. With template, creates a new note from that template of the notebook (notebookId, or the notebook of path), filling its placeholders from values: path may be left out when the template declares a path pattern, an existing note at the path is refused, content and metadata given here win over the template, the note records the template as template: <id>, and the result lists the unfilled placeholders left as literal {{name}} text. ${TEMPLATE_GUIDANCE} Nothing is committed; the person reviews and commits it. ${SCOPE_GUIDANCE}`, parameters: Type.Object({ path: Type.Optional(Type.String({ description: 'Required unless template declares a path pattern.' })), content: Type.Optional(Type.String({ description: 'The Markdown body, without frontmatter. Required without template.' })), metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Frontmatter; keys left out keep their values.' })), template: Type.Optional(Type.String({ description: 'A template id from mygitnotes_list_templates; creates the note from that template.' })), values: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Placeholder values by name for template; title, date and time may be given too. A name the template does not have is refused.' })), title: Type.Optional(Type.String({ description: "With template: the new note's title." })), ...target }) }, { name: 'mygitnotes_edit_note', label: 'Edit note', description: `Replace one exact, unique occurrence of oldText in the note body with newText, as a working change. Read the note first. ${SCOPE_GUIDANCE}`, parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String(), ...target }) }, { name: 'mygitnotes_delete_note', label: 'Delete note', description: `Delete a note as a working change: it moves to the person's uncommitted trash, where they can restore it, and goes only when they commit. ${SCOPE_GUIDANCE}`, parameters: Type.Object({ path: Type.String(), ...target }) }, { name: 'mygitnotes_agent_system', label: 'Agent system', description: "The instructions and skills that govern a note or folder: the AGENTS.md of every agent folder from the repository root down to it (root first, with contents) and the skills of those folders (name, description, SKILL.md path, directory), the nearest folder winning a shared skill name. Pass a note or folder path (repository-relative), or a notebookId alone for a notebook's root; with neither, it answers for the agent workspace this session runs in. Read a skill's files with mygitnotes_read_agent_file.", parameters: Type.Object({ path: Type.Optional(Type.String({ description: 'A note or folder path, such as blog/posts/plan.md.' })), ...target }) }, { name: 'mygitnotes_read_agent_file', label: 'Read agent file', description: "Read the text of an AGENTS.md or a skill file (SKILL.md, a reference or a script under .agents/skills/<name>/) of the workspace. Any other path is refused. Name the notebookId when the file belongs to a notebook other than this session's agent workspace.", parameters: Type.Object({ path: Type.String({ description: 'Repository-relative, such as blog/.agents/skills/post/SKILL.md.' }), ...target }) }, { name: 'mygitnotes_list_changes', label: 'List changes', description: "List the person's working changes (added, modified, deleted), with a unified diff of each.", parameters: Type.Object({}) }, { name: 'mygitnotes_list_templates', label: 'List templates', description: `List the note templates of a notebook, or of every notebook: its manifest-registered templates and the Markdown files in its .templates/ folder, as the person sees them, each with the placeholders it exposes (name, description, default, declared; title, date and time are built in) and when it was last used. The most recently used come first, then the never-used by name; query narrows the list, limit cuts it (total counts the matches, truncated says more remain). With notebookId and templateId, returns that one template with its file text as content. ${TEMPLATE_GUIDANCE}`, parameters: Type.Object({ query: Type.Optional(Type.String({ description: 'Words to match against template id, name and description; every word must match, whatever the case.' })), templateId: Type.Optional(Type.String({ description: 'With notebookId: return this one template, with its file text as content.' })), limit: Type.Optional(Type.Integer({ description: 'Maximum returned templates; default 20.', minimum: 1, maximum: 100 })), ...target }) }];

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
