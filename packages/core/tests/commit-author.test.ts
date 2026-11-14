import { describe, expect, it } from 'vitest';
import { commitAuthor, withCoAuthors } from '../src/commit-author.js';
import { agentEditMessage } from '../src/note-versions.js';
import { openRemoteRepository } from '../src/remote-factory.js';
import { gitlabFixture } from './fixtures/gitlab.js';
import { githubFixture } from './fixtures/github.js';

const pat = { name: 'Pat Example', email: 'pat@example.test' };
const sam = { name: 'Sam Example', email: 'sam@example.test' };
const lee = { name: 'Lee Example', email: 'lee@example.test' };
const gitlabSource = { type: 'gitlab' as const, url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' };
const githubSource = { type: 'github' as const, repository: 'owner/repo', branch: 'main' };

/** A GitLab project, a reader on it that commits as `author`, and the bodies of the commits it posted. */
function gitlab(author?: unknown) {
  const f = gitlabFixture();
  const reader = openRemoteRepository(gitlabSource, 'bot-token', f.request, undefined, author as typeof pat).reader;
  const posted = () => f.calls.filter(call => call.init?.method === 'POST').map(call => String(call.init!.body));
  return { f, reader, posted, sent: () => posted().length };
}
/** The same for a GitHub repository: the bodies sent to `POST /git/commits`. */
function github(author?: unknown) {
  const f = githubFixture();
  const reader = openRemoteRepository(githubSource, 'bot-token', f.request, undefined, author as typeof pat).reader;
  const posted = () => f.calls.filter(call => call.endpoint === '/git/commits').map(call => call.body);
  return { f, reader, posted, sent: () => f.calls.filter(call => call.method).length };
}

describe('the author of a commit a source publishes', () => {
  it('is sent to GitLab as author_name and author_email, and left out when the source has none', async () => {
    const authored = gitlab(pat);
    // Saved without metadata, so nothing in the note carries the time of the save.
    await authored.reader.save('notes/ex/a.md', '# Changed', undefined, authored.f.head);
    const body = JSON.parse(authored.posted()[0]);
    expect(body).toMatchObject({ branch: 'main', force: false, author_name: 'Pat Example', author_email: 'pat@example.test' });

    const plain = gitlab();
    await plain.reader.save('notes/ex/a.md', '# Changed', undefined, plain.f.head);
    // Without an author the request is what it was before sources had one: the same keys in the same order.
    expect(Object.keys(JSON.parse(plain.posted()[0]))).toEqual(['branch', 'commit_message', 'actions', 'force']);
    expect(plain.posted()[0]).not.toContain('author');
    const { author_name: _name, author_email: _email, ...rest } = body;
    expect(JSON.stringify(rest)).toBe(plain.posted()[0]);
  });

  it('is sent to GitHub as the author object of the commit, and left out when the source has none', async () => {
    const authored = github(pat);
    await authored.reader.save('notes/ex/a.md', '# Changed', {}, authored.f.head());
    expect(authored.posted()).toEqual([{ message: 'docs(notes): write a.md', tree: expect.any(String), parents: [expect.any(String)], author: { name: 'Pat Example', email: 'pat@example.test' } }]);

    const plain = github();
    await plain.reader.save('notes/ex/a.md', '# Changed', {}, plain.f.head());
    expect(plain.posted()).toHaveLength(1);
    expect(Object.keys(plain.posted()[0])).toEqual(['message', 'tree', 'parents']);
  });

  it('is on every commit the source publishes, a skill rename included', async () => {
    const f = githubFixture({ 'notes/ex/.agents/skills/demo/SKILL.md': '---\nname: demo\ndescription: Demo.\n---\n# Demo\n' });
    const reader = openRemoteRepository(githubSource, 'bot-token', f.request, undefined, pat).reader;
    await reader.renameAgentSkill('notes/ex/.agents/skills/demo/SKILL.md', 'renamed', '---\nname: demo\ndescription: Demo.\n---\n# Demo\n', f.head());
    expect(f.calls.filter(call => call.endpoint === '/git/commits').map(call => call.body)).toEqual([expect.objectContaining({ message: 'docs(agents): rename demo to renamed', author: pat })]);
    expect(f.files()).toContain('notes/ex/.agents/skills/renamed/SKILL.md');
  });

  it('counts an empty or missing name or email as no author', async () => {
    for (const none of [undefined, null, {}, { name: '', email: '' }, { name: '  ', email: 'pat@example.test' }, { name: 'Pat Example', email: '' }, { name: 'Pat Example' }]) {
      expect(commitAuthor(none)).toBeUndefined();
      const { f, reader, posted } = gitlab(none);
      await reader.save('notes/ex/a.md', '# Changed', {}, f.head);
      expect(posted()[0]).not.toContain('author');
    }
    expect(commitAuthor({ name: ' Pat Example ', email: ' pat@example.test ', login: 'pat' })).toEqual(pat);
  });

  it.each([['a newline in the name', { name: 'Pat\nCo-authored-by: Mallory <m@example.test>', email: 'pat@example.test' }], ['a carriage return in the email', { name: 'Pat', email: 'pat@example.test\rX-Header: 1' }], ['an angle bracket in the name', { name: 'Pat <admin@example.test>', email: 'pat@example.test' }], ['a closing bracket in the email', { name: 'Pat', email: 'pat@example.test> Mallory <m@example.test' }], ['a control character', { name: 'Pat\u0000', email: 'pat@example.test' }], ['a tab', { name: 'Pat\tExample', email: 'pat@example.test' }], ['a Unicode line separator', { name: 'Pat\u2028Example', email: 'pat@example.test' }], ['a C1 control character', { name: 'Pat', email: 'pat\u0085@example.test' }], ['a name that is not text', { name: ['Pat'], email: 'pat@example.test' }], ['an author that is not an object', 'Pat <pat@example.test>']])('refuses %s before anything is sent', async (_what, author) => {
    expect(() => commitAuthor(author)).toThrow(expect.objectContaining({ status: 400 }));
    for (const { f, reader, sent } of [gitlab(author), github(author)]) {
      const head = typeof f.head === 'function' ? f.head() : f.head;
      // Reading needs no author, so a person with an unusable one still reads.
      expect((await reader.notes()).length).toBeGreaterThan(0);
      await expect(reader.save('notes/ex/a.md', '# Changed', {}, head)).rejects.toMatchObject({ status: 400, message: "The commit author's name or email cannot be written into a commit." });
      // Not a blob or a tree either.
      expect(sent()).toBe(0);
    }
  });
});

describe('co-authors of a commit', () => {
  it('become Co-authored-by trailers in the order given, once each, without the author', () => {
    expect(withCoAuthors('docs(notes): live edit a.md', [sam, lee, { name: 'Sam E.', email: 'SAM@example.test' }, pat], pat)).toBe('docs(notes): live edit a.md\n\nCo-authored-by: Sam Example <sam@example.test>\nCo-authored-by: Lee Example <lee@example.test>');
    // Without an author nobody is left out.
    expect(withCoAuthors('docs(notes): live edit a.md', [pat, sam])).toBe('docs(notes): live edit a.md\n\nCo-authored-by: Pat Example <pat@example.test>\nCo-authored-by: Sam Example <sam@example.test>');
    expect(withCoAuthors('docs(notes): live edit a.md', [pat], pat)).toBe('docs(notes): live edit a.md');
    expect(withCoAuthors('docs(notes): live edit a.md', [])).toBe('docs(notes): live edit a.md');
  });

  it('join the trailers a message already ends with, after them, and start a block where there is none', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(withCoAuthors(agentEditMessage('docs(notes): write a.md', now), [sam])).toBe('docs(notes): write a.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07\nCo-authored-by: Sam Example <sam@example.test>');
    expect(withCoAuthors('Fix intro\n\nReworded the opening.\n\nNote-Modified: notes/ex/a.md\nAgent-Edit: 2026-10-07\n', [sam, lee])).toBe('Fix intro\n\nReworded the opening.\n\nNote-Modified: notes/ex/a.md\nAgent-Edit: 2026-10-07\nCo-authored-by: Sam Example <sam@example.test>\nCo-authored-by: Lee Example <lee@example.test>');
    expect(withCoAuthors('Fix intro\n\nReworded the opening.', [sam])).toBe('Fix intro\n\nReworded the opening.\n\nCo-authored-by: Sam Example <sam@example.test>');
    // A subject that reads like a trailer is still the subject, and a paragraph with prose in it is no trailer block.
    expect(withCoAuthors('fix: typo', [sam])).toBe('fix: typo\n\nCo-authored-by: Sam Example <sam@example.test>');
    expect(withCoAuthors('Fix intro\n\nSee: the notes\nand the rest.', [sam])).toBe('Fix intro\n\nSee: the notes\nand the rest.\n\nCo-authored-by: Sam Example <sam@example.test>');
  });

  it('are not repeated when the message already names them', () => {
    const once = withCoAuthors('docs(notes): live edit a.md', [sam, lee], pat);
    expect(withCoAuthors(once, [lee, sam], pat)).toBe(once);
    expect(withCoAuthors(once, [{ name: 'Kim Example', email: 'kim@example.test' }, sam], pat)).toBe(`${once}\nCo-authored-by: Kim Example <kim@example.test>`);
    // CRLF line ends, a trailer without the space and one outside the last paragraph still name the person.
    for (const named of ['s\r\n\r\nCo-authored-by: Sam Example <sam@example.test>\r\n', 's\n\nCo-authored-by:Sam Example <sam@example.test>', 's\n\nCo-authored-by: Sam Example <sam@example.test>\n\nbody']) expect(withCoAuthors(named, [sam])).toBe(named);
  });

  it('are refused past a bounded length or count, and with characters that change how a name reads', () => {
    expect(() => commitAuthor({ name: 'S'.repeat(257), email: 'sam@example.test' })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => commitAuthor({ name: 'Sam', email: `${'s'.repeat(320)}@x` })).toThrow(expect.objectContaining({ status: 400 }));
    expect(commitAuthor({ name: 'S'.repeat(256), email: 'sam@example.test' })?.name).toHaveLength(256);
    for (const name of ['Sam\u202eelpmaxE', 'Sam\u2066x\u2069', '\ufeffSam']) expect(() => commitAuthor({ name, email: 'sam@example.test' })).toThrow(expect.objectContaining({ status: 400 }));
    // Joiners some scripts write names with stay.
    expect(commitAuthor({ name: 'ര\u200dമ', email: 'r@example.test' })?.name).toBe('ര\u200dമ');
    const many = Array.from({ length: 51 }, (_, index) => ({ name: `P${index}`, email: `p${index}@example.test` }));
    expect(() => withCoAuthors('s', many)).toThrow(expect.objectContaining({ status: 400 }));
    expect(withCoAuthors('s', many.slice(0, 50)).split('\n').length).toBe(52);
  });

  it('are refused with a name or email that could start another trailer, and skipped when empty', () => {
    for (const bad of [{ name: 'Sam\nAgent-Edit: 2026-10-07', email: 'sam@example.test' }, { name: 'Sam', email: 'sam@example.test>\nCo-authored-by: M <m@example.test' }, { name: 'Sam <root@example.test>', email: 'sam@example.test' }, { name: 'Sam\u001b[0m', email: 'sam@example.test' }]) expect(() => withCoAuthors('docs(notes): live edit a.md', [sam, bad])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => withCoAuthors('docs(notes): live edit a.md', 'Sam <sam@example.test>' as never)).toThrow(expect.objectContaining({ status: 400 }));
    expect(withCoAuthors('docs(notes): live edit a.md', [{ name: '', email: '' }, sam])).toBe('docs(notes): live edit a.md\n\nCo-authored-by: Sam Example <sam@example.test>');
  });

  it('ride on commitChanges after the message it was given or made, on both providers', async () => {
    const lab = gitlab(pat);
    const receipt = await lab.reader.commitChanges([{ path: 'notes/ex/a.md', content: '# Live\n' }], lab.f.head, 'write', 'notes', agentEditMessage('docs(notes): live edit a.md', new Date('2026-10-07T12:00:00Z')), undefined, [pat, sam, sam, lee]);
    const expected = 'docs(notes): live edit a.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07\nCo-authored-by: Sam Example <sam@example.test>\nCo-authored-by: Lee Example <lee@example.test>';
    expect(JSON.parse(lab.posted()[0])).toMatchObject({ commit_message: expected, author_name: 'Pat Example', author_email: 'pat@example.test' });
    expect(receipt.commit.message).toBe(expected);

    const hub = github();
    await hub.reader.commitChanges([{ path: 'notes/ex/a.md', content: '# Live\n' }], hub.f.head(), 'write', 'notes', undefined, undefined, [sam]);
    expect(hub.posted()).toEqual([{ message: 'docs(notes): write a.md\n\nCo-authored-by: Sam Example <sam@example.test>', tree: expect.any(String), parents: [expect.any(String)] }]);

    const refused = gitlab(pat);
    await expect(refused.reader.commitChanges([{ path: 'notes/ex/a.md', content: '# Live\n' }], refused.f.head, 'write', 'notes', undefined, undefined, [{ name: 'Sam\nX: y', email: 'sam@example.test' }])).rejects.toMatchObject({ status: 400 });
    expect(refused.posted()).toEqual([]);
  });
});
