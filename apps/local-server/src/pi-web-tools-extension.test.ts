import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webTools, { formatAgentSystem } from './pi-web-tools-extension.mjs';

// Pi supplies typebox to its extensions; the schemas are not what these tests look at.
vi.mock('typebox', () => {
  const schema = (value?: unknown) => ({ schema: value });
  return { Type: { Object: schema, String: schema, Optional: schema, Record: schema, Unknown: schema } };
});

interface Call { tool: string; arguments: Record<string, unknown>; }
type Handler = (event: { systemPrompt: string; }) => Promise<{ systemPrompt: string; } | undefined>;

const agentSystem = {
  workspace: { repository: 'github:me/notes@main', folder: '' },
  files: [{ path: 'AGENTS.md', content: 'Root rules.\n' }, { path: 'blog/AGENTS.md', content: 'Blog rules.\n' }],
  skills: [{ name: 'post', description: 'Write a post', path: 'blog/.agents/skills/post/SKILL.md', directory: 'blog/.agents/skills/post' }],
};

let server: Server | undefined;
let calls: Call[];
let answer: (call: Call) => { status: number; body: unknown; };

async function bridge() {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const call = JSON.parse(body) as Call;
      calls.push(call);
      const { status, body: reply } = answer(call);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
    });
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server port');
  return `http://127.0.0.1:${address.port}/web-tools`;
}

/** Loads the extension the way Pi does and returns what it registered. */
function load() {
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ details: unknown; }>; }>();
  const handlers = new Map<string, Handler>();
  webTools({ registerTool: tool => tools.set(tool.name, tool as never), on: (event, handler) => handlers.set(event, handler) });
  return { tools, start: handlers.get('before_agent_start') };
}

beforeEach(async () => {
  calls = [];
  answer = call => ({ status: 200, body: { result: call.tool === 'agent_system' ? agentSystem : { path: 'x' } } });
  vi.stubEnv('MYGITNOTES_WEB_TOOLS_URL', await bridge());
  vi.stubEnv('MYGITNOTES_WEB_TOOLS_TOKEN', 'token');
  vi.stubEnv('MYGITNOTES_AGENT_REPOSITORY', 'github:me/notes@main');
  vi.stubEnv('MYGITNOTES_AGENT_FOLDER', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise(resolve => server!.close(resolve));
});

describe('web tools extension', () => {
  it('offers the note tools and the two agent-system tools', () => {
    expect([...load().tools.keys()]).toEqual(['mygitnotes_read_note', 'mygitnotes_write_note', 'mygitnotes_edit_note', 'mygitnotes_delete_note', 'mygitnotes_agent_system', 'mygitnotes_read_agent_file', 'mygitnotes_list_changes']);
  });

  it("names the session's workspace in agent-system calls, whatever the agent passes, and in no other call", async () => {
    const { tools } = load();
    await tools.get('mygitnotes_agent_system')!.execute('1', { path: 'blog/post.md', workspace: { repository: 'forged', folder: 'x' } });
    await tools.get('mygitnotes_read_agent_file')!.execute('2', { path: 'AGENTS.md' });
    await tools.get('mygitnotes_read_note')!.execute('3', { path: 'notes/a.md' });
    const workspace = { repository: 'github:me/notes@main', folder: '' };
    expect(calls).toEqual([{ tool: 'agent_system', arguments: { path: 'blog/post.md', workspace } }, { tool: 'read_agent_file', arguments: { path: 'AGENTS.md', workspace } }, { tool: 'read_note', arguments: { path: 'notes/a.md' } }]);
  });

  it("appends the session workspace's agent system to the system prompt, and asks the page once", async () => {
    const { start } = load();
    const first = await start!({ systemPrompt: 'Base.' });
    expect(first?.systemPrompt).toBe(`Base.${formatAgentSystem(agentSystem)}`);
    expect(first?.systemPrompt).toContain('## AGENTS.md\nRoot rules.');
    expect(first?.systemPrompt).toContain('## blog/AGENTS.md\nBlog rules.');
    expect(first?.systemPrompt).toContain('- post: Write a post (blog/.agents/skills/post/SKILL.md)');
    expect(first?.systemPrompt).toContain('mygitnotes_read_agent_file');
    expect((await start!({ systemPrompt: 'Base.' }))?.systemPrompt).toBe(first?.systemPrompt);
    expect(calls).toEqual([{ tool: 'agent_system', arguments: { workspace: { repository: 'github:me/notes@main', folder: '' } } }]);
  });

  it('lets the run proceed when the page cannot answer, and asks again at the next run', async () => {
    answer = () => ({ status: 503, body: { error: 'Open MyGitNotes in a browser to let the agent edit notes.' } });
    const { start } = load();
    await expect(start!({ systemPrompt: 'Base.' })).resolves.toBeUndefined();
    answer = () => ({ status: 200, body: { result: agentSystem } });
    expect((await start!({ systemPrompt: 'Base.' }))?.systemPrompt).toContain('Root rules.');
    expect(calls).toHaveLength(2);
  });

  it('lets the run proceed when the bridge cannot be reached at all', async () => {
    vi.stubEnv('MYGITNOTES_WEB_TOOLS_URL', 'http://127.0.0.1:1/web-tools');
    await expect(load().start!({ systemPrompt: 'Base.' })).resolves.toBeUndefined();
  });

  it('adds nothing for a workspace without instructions or skills, and nothing when the session names no workspace', async () => {
    answer = () => ({ status: 200, body: { result: { workspace: agentSystem.workspace, files: [], skills: [] } } });
    await expect(load().start!({ systemPrompt: 'Base.' })).resolves.toBeUndefined();
    vi.stubEnv('MYGITNOTES_AGENT_REPOSITORY', '');
    calls = [];
    await expect(load().start!({ systemPrompt: 'Base.' })).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('formatAgentSystem', () => {
  it('says where the workspace is, and tells how to load a skill', () => {
    const text = formatAgentSystem({ ...agentSystem, workspace: { repository: 'github:me/notes@main', folder: 'blog' } });
    expect(text).toContain('(blog of github:me/notes@main)');
    expect(formatAgentSystem({ ...agentSystem, skills: [] })).not.toContain('## Skills');
    expect(formatAgentSystem({ workspace: agentSystem.workspace })).toBe('');
  });
});
