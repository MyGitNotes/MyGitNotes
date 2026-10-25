import { describe, expect, it } from 'vitest';
import { parseWorkspaceConfig, serializeWorkspaceConfig, validateWorkspaceConfig } from '../src/config.js';
import { isNoteHidden, mergeNotebookStatuses, noteStatusNames, resolveNoteStatuses, STATUS_COLOR_NAMES, statusColor, withNoteStatus } from '../src/note-status.js';

const manifest = (statuses?: unknown) => ({ schema_version: 1, workspace: { title: 'Notes', default_notebook: 'personal' }, notebooks: [{ id: 'personal', title: 'Personal', root: 'notes/personal', ...(statuses !== undefined ? { statuses } : {}) }, { id: 'research', title: 'Research', root: 'notes/research' }] });

describe('notebook status vocabulary', () => {
  it('defaults archived to hidden and respects explicit visibility booleans', () => {
    expect(isNoteHidden({ status: 'archived' })).toBe(true);
    expect(isNoteHidden({ status: 'archived', hiden: false })).toBe(false);
    expect(isNoteHidden({ status: 'working', hiden: true })).toBe(true);
    expect(isNoteHidden({ status: 'working' })).toBe(false);
    expect(isNoteHidden({})).toBe(false);
    expect(isNoteHidden({ status: 'working', hiden: 'false' } as any)).toBe(false);
  });

  it('persists archive transitions and preserves manually hidden non-archived notes', () => {
    const metadata = { status: 'working', custom: { keep: true } };
    const archived = withNoteStatus(metadata, 'archived');
    expect(archived).toEqual({ ...metadata, status: 'archived', hiden: true });
    expect(withNoteStatus(archived, 'working')).toEqual({ ...metadata, hiden: false });
    expect(withNoteStatus({ ...metadata, hiden: true }, 'review')).toEqual({ ...metadata, status: 'review', hiden: true });
    expect(withNoteStatus(archived, '')).toEqual({ ...metadata, status: undefined, hiden: false });
    expect(metadata).toEqual({ status: 'working', custom: { keep: true } });
  });

  it('uses note defaults for absent or empty definitions', () => {
    for (const statuses of [undefined, []]) {
      const config = validateWorkspaceConfig(manifest(statuses));
      expect(resolveNoteStatuses(config.notebooks[0])).toEqual(['inbox', 'working', 'done', 'archived']);
    }
  });

  it('round trips custom order and keeps notebooks independent', () => {
    const config = validateWorkspaceConfig(manifest(['capture', 'Review', 'published']));
    const reloaded = parseWorkspaceConfig(serializeWorkspaceConfig(config));
    expect(resolveNoteStatuses(reloaded.notebooks[0])).toEqual(['capture', 'Review', 'published']);
    expect(resolveNoteStatuses(reloaded.notebooks[1])).toEqual(['inbox', 'working', 'done', 'archived']);
    expect(reloaded.notebooks[1]).not.toHaveProperty('statuses');
  });

  it('appends observed legacy and unknown values without rewriting either input', () => {
    const notebook = { statuses: ['capture', 'Review'] };
    const observed = ['doing', 'Review', 'review', undefined, '', 'done', 'doing', '__proto__'];
    const before = JSON.stringify({ notebook, observed });
    expect(resolveNoteStatuses(notebook, observed)).toEqual(['capture', 'Review', '__proto__', 'doing', 'done', 'review']);
    expect(JSON.stringify({ notebook, observed })).toBe(before);
    expect(resolveNoteStatuses({ statuses: [] }, ['doing'])).toContain('doing');
  });

  it.each([null, 'inbox', [42], [''], ['  '], [' inbox'], ['done '], ['inbox', 'inbox']])('rejects malformed status definitions: %j', statuses => {
    expect(() => validateWorkspaceConfig(manifest(statuses))).toThrow(/statuses must be an array/);
  });
});

describe('notebook status colours', () => {
  it('accepts plain strings and name/colour objects, keeping both forms through a round trip', () => {
    const statuses = ['inbox', { name: 'review', color: 'purple' }, { name: 'later' }, 'done'];
    const config = validateWorkspaceConfig(manifest(statuses));
    expect(config.notebooks[0].statuses).toEqual(statuses);
    const reloaded = parseWorkspaceConfig(serializeWorkspaceConfig(config));
    expect(reloaded.notebooks[0].statuses).toEqual(statuses);
    expect(resolveNoteStatuses(reloaded.notebooks[0])).toEqual(['inbox', 'review', 'later', 'done']);
    expect(noteStatusNames(reloaded.notebooks[0].statuses)).toEqual(['inbox', 'review', 'later', 'done']);
  });

  it('parses the YAML flow form of an entry', () => {
    const config = parseWorkspaceConfig(`schema_version: 1
workspace: { title: Notes, default_notebook: a }
notebooks:
  - id: a
    title: A
    root: notes/a
    statuses:
      - inbox
      - { name: review, color: purple }
`);
    expect(config.notebooks[0].statuses).toEqual(['inbox', { name: 'review', color: 'purple' }]);
  });

  it.each(STATUS_COLOR_NAMES)('accepts the palette colour %s', color => {
    expect(validateWorkspaceConfig(manifest([{ name: 'x', color }])).notebooks[0].statuses).toEqual([{ name: 'x', color }]);
  });

  it.each(['Purple', 'violet', '#ff0000', '', 'primary'])('rejects the colour %j and names the accepted ones', color => {
    expect(() => validateWorkspaceConfig(manifest([{ name: 'review', color }]))).toThrow(/status 'review' has an unknown color .*green, blue, amber, red, purple, teal, pink, gray/);
  });

  it.each([[{ name: 'x', color: 3 }], [{ name: 'x', colour: 'red' }], [{ color: 'red' }], [{ name: ' x', color: 'red' }], [{ name: '', color: 'red' }], [['x']], [{ name: 'x', color: 'red' }, 'x'], ['x', { name: 'x', color: 'red' }], [{ name: 'x', color: 'red' }, { name: 'x', color: 'blue' }]])('rejects malformed entries: %j', (...statuses) => {
    expect(() => validateWorkspaceConfig(manifest(statuses))).toThrow(/Notebook 'personal' status|statuses must be an array/);
  });

  it('rejects an entry whose name repeats another by name, whatever its form', () => {
    expect(() => validateWorkspaceConfig(manifest(['x', { name: 'x', color: 'red' }]))).toThrow(/distinct/);
  });
});

describe('statusColor', () => {
  it('keeps the known names on their familiar colours, ignoring case', () => {
    expect(['done', 'Done', 'working', 'doing', 'in-progress', 'todo', 'inbox', 'archived'].map(status => statusColor(status))).toEqual(['green', 'green', 'blue', 'blue', 'blue', 'amber', 'primary', 'muted']);
  });

  it('uses the colour a notebook gives a status, even on a known name', () => {
    expect(statusColor('review', ['inbox', { name: 'review', color: 'pink' }])).toBe('pink');
    expect(statusColor('done', [{ name: 'done', color: 'teal' }])).toBe('teal');
  });

  it('cycles the palette by position for uncoloured custom statuses', () => {
    const list = ['capture', 'draft', 'review', 'ship', 'edit', 'qa', 'wait', 'misc', 'more'];
    const colours = list.map(status => statusColor(status, list));
    expect(colours.slice(0, 8)).toEqual([...new Set(colours.slice(0, 8))]);
    expect(new Set(colours.slice(0, 8))).toEqual(new Set(STATUS_COLOR_NAMES));
    expect(colours[8]).toBe(colours[0]);
    expect(colours.every(colour => colour !== 'muted')).toBe(true);
  });

  it('colours by position in the list as written, so reordering moves the colour', () => {
    expect(statusColor('review', ['review', 'draft'])).not.toBe(statusColor('review', ['draft', 'review']));
  });

  it('leaves a status that is not in the list muted unless it is a known name', () => {
    expect(statusColor('stray', ['capture', 'review'])).toBe('muted');
    expect(statusColor('stray')).toBe('muted');
    expect(statusColor('done', ['capture'])).toBe('green');
    expect(statusColor('', ['capture'])).toBe('muted');
  });

  it('matches a list entry ignoring case when no entry matches exactly', () => {
    expect(statusColor('Review', [{ name: 'review', color: 'red' }])).toBe('red');
  });

  it('merges several notebooks, keeping the first explicit colour for a name', () => {
    expect(noteStatusNames(mergeNotebookStatuses([{ statuses: ['a', { name: 'b', color: 'red' }] }, { statuses: [{ name: 'a', color: 'teal' }, 'b', 'c'] }, {}]))).toEqual(['a', 'b', 'c', 'inbox', 'working', 'done', 'archived']);
    expect(mergeNotebookStatuses([{ statuses: ['a', { name: 'b', color: 'red' }] }, { statuses: [{ name: 'a', color: 'teal' }, 'b'] }]).find(entry => noteStatusNames([entry])[0] === 'a')).toEqual({ name: 'a', color: 'teal' });
  });
});
