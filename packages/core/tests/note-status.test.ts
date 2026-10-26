import { describe, expect, it } from 'vitest';
import { parseWorkspaceConfig, serializeWorkspaceConfig, validateWorkspaceConfig } from '../src/config.js';
import { isNoteHidden, mergeNotebookStatuses, noteStatusNames, resolveNoteStatuses, STATUS_COLOR_NAMES, STATUS_CYCLE, statusColor, statusLabel, withNoteStatus } from '../src/note-status.js';

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

  it('cycles the palette by position for uncoloured custom statuses, never reaching gray', () => {
    const list = ['capture', 'draft', 'review', 'ship', 'edit', 'qa', 'wait', 'misc', 'more'];
    const colours = list.map(status => statusColor(status, list));
    expect(colours.slice(0, 7)).toEqual([...new Set(colours.slice(0, 7))]);
    expect(new Set(colours.slice(0, 7))).toEqual(new Set(STATUS_COLOR_NAMES.filter(color => color !== 'gray')));
    expect(colours[7]).toBe(colours[0]);
    expect(colours.every(colour => colour !== 'muted' && colour !== 'gray')).toBe(true);
    expect(statusColor('quiet', [{ name: 'quiet', color: 'gray' }])).toBe('gray');
  });

  it('counts only custom entries, so known names and defaults do not shift the cycle', () => {
    expect(statusColor('capture', ['inbox', 'capture', 'done', 'review'])).toBe(statusColor('capture', ['capture', 'review']));
    expect(statusColor('review', ['inbox', 'capture', 'done', 'review'])).toBe(statusColor('review', ['capture', 'review']));
    expect(statusColor('review', ['Done', 'capture', 'review'])).toBe(statusColor('review', ['capture', 'review']));
  });

  it('skips the colour a theme asks it to avoid', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const avoid of STATUS_CYCLE) {
      const colours = list.map(status => statusColor(status, list, avoid));
      expect(colours, avoid).not.toContain(avoid);
      expect(new Set(colours.slice(0, 6)).size, avoid).toBe(6);
    }
  });

  it('keeps pink and red apart in the cycle whichever colour is skipped', () => {
    for (const avoid of [undefined, ...STATUS_CYCLE]) {
      const cycle = STATUS_CYCLE.filter(color => color !== avoid);
      const pink = cycle.indexOf('pink');
      const red = cycle.indexOf('red');
      if (pink === -1 || red === -1) continue;
      expect(Math.min((pink - red + cycle.length) % cycle.length, (red - pink + cycle.length) % cycle.length), String(avoid)).toBeGreaterThan(1);
    }
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

  it('gives a status the same colour whichever notebooks are listed and in what order', () => {
    const alone = mergeNotebookStatuses([{ statuses: ['capture', 'review'] }]);
    const colours = (entries: ReturnType<typeof mergeNotebookStatuses>) => ['capture', 'review'].map(status => statusColor(status, entries));
    expect(colours(alone)).toEqual(['purple', 'teal']);
    expect(colours(mergeNotebookStatuses([{}, { statuses: ['capture', 'review'] }]))).toEqual(colours(alone));
    expect(colours(mergeNotebookStatuses([{ statuses: ['capture', 'review'] }, {}]))).toEqual(colours(alone));
    expect(colours(mergeNotebookStatuses([{ statuses: [] }, { statuses: ['capture', 'review'] }]))).toEqual(colours(alone));
  });

  it("keeps each notebook's own cycle in a merged scope and the first defining notebook's colour for a shared name", () => {
    const merged = mergeNotebookStatuses([{ statuses: ['capture', 'review'] }, { statuses: ['draft', 'review', 'capture', 'extra'] }]);
    expect(['capture', 'review', 'draft', 'extra'].map(status => statusColor(status, merged))).toEqual(['purple', 'teal', 'purple', 'blue']);
  });

  it('passes the colour to avoid on to the cycled statuses', () => {
    expect(['capture', 'review'].map(status => statusColor(status, mergeNotebookStatuses([{ statuses: ['capture', 'review'] }], 'purple')))).toEqual(['teal', 'pink']);
  });
});

describe('notebook status labels', () => {
  const labelled = [{ name: 'working', color: 'blue', label: { en: 'In progress', 'zh-TW': '進行中' } }, { name: 'review', label: '審核中' }, 'later'];

  it('accepts a label as a string or a map of language to string and keeps it through a round trip', () => {
    const config = validateWorkspaceConfig(manifest(labelled));
    expect(config.notebooks[0].statuses).toEqual(labelled);
    expect(parseWorkspaceConfig(serializeWorkspaceConfig(config)).notebooks[0].statuses).toEqual(labelled);
    expect(noteStatusNames(config.notebooks[0].statuses)).toEqual(['working', 'review', 'later']);
  });

  it('parses the YAML form of a label', () => {
    const config = parseWorkspaceConfig(`schema_version: 1
workspace: { title: Notes, default_notebook: a }
notebooks:
  - id: a
    title: A
    root: notes/a
    statuses:
      - { name: working, color: blue, label: { en: In progress, zh-TW: 進行中 } }
      - { name: review, label: 審核中 }
`);
    expect(config.notebooks[0].statuses).toEqual([{ name: 'working', color: 'blue', label: { en: 'In progress', 'zh-TW': '進行中' } }, { name: 'review', label: '審核中' }]);
  });

  it.each([[3], [''], ['  '], [[]], [['x']], [{}], [{ en: '' }], [{ en: 3 }], [{ '': 'x' }], [null]])('rejects the label %j and says what a label is', label => {
    expect(() => validateWorkspaceConfig(manifest([{ name: 'review', label }]))).toThrow(/status 'review' has an invalid label.*string.*language/);
  });

  it('still rejects unknown keys, now naming label among the accepted ones', () => {
    expect(() => validateWorkspaceConfig(manifest([{ name: 'review', title: 'x' }]))).toThrow(/unknown key 'title'; an entry takes only name, color and label/);
  });

  it('resolves a label for the language, then the primary language, then the built-in label, then the name', () => {
    expect(statusLabel('working', labelled, 'en')).toBe('In progress');
    expect(statusLabel('working', labelled, 'zh-TW')).toBe('進行中');
    expect(statusLabel('working', [{ name: 'working', label: { zh: '進行中' } }], 'zh-TW')).toBe('進行中');
    expect(statusLabel('working', [{ name: 'working', label: { 'zh-tw': '進行中' } }], 'zh-TW')).toBe('進行中');
    expect(statusLabel('working', [{ name: 'working', label: { en: 'In progress' } }], 'zh-TW')).toBe('進行中');
    expect(statusLabel('review', [{ name: 'review', label: { en: 'In review' } }], 'zh-TW')).toBe('review');
    expect(statusLabel('review', labelled, 'en')).toBe('審核中');
    expect(statusLabel('later', labelled, 'zh-TW')).toBe('later');
  });

  it('translates the built-in statuses only when the manifest gives no label', () => {
    expect(['inbox', 'working', 'done', 'archived'].map(status => statusLabel(status, [], 'zh-TW'))).toEqual(['收件匣', '進行中', '完成', '封存']);
    expect(['inbox', 'working', 'done', 'archived'].map(status => statusLabel(status, undefined, 'en'))).toEqual(['inbox', 'working', 'done', 'archived']);
    expect(statusLabel('done', ['inbox', 'done'], 'zh-TW')).toBe('完成');
    expect(statusLabel('done', [{ name: 'done', label: 'Shipped' }], 'zh-TW')).toBe('Shipped');
    expect(statusLabel('Done', [], 'zh-TW')).toBe('完成');
  });

  it('keeps a custom status or an unknown language as its name', () => {
    expect(statusLabel('capture', [], 'zh-TW')).toBe('capture');
    expect(statusLabel('done', [], 'fr')).toBe('done');
    expect(statusLabel('', [], 'zh-TW')).toBe('');
  });

  it('carries a label through a merge, taking the first notebook that gives one', () => {
    const merged = mergeNotebookStatuses([{ statuses: ['a', { name: 'b', label: 'B1' }] }, { statuses: [{ name: 'a', color: 'teal', label: 'A2' }, { name: 'b', label: 'B2' }, { name: 'c', label: 'C' }] }]);
    expect(merged.map(entry => statusLabel(noteStatusNames([entry])[0], merged, 'en'))).toEqual(['A2', 'B1', 'C']);
    expect(statusColor('a', merged)).toBe('teal');
    expect(statusLabel('c', mergeNotebookStatuses([{ statuses: ['x', { name: 'c', label: 'C' }] }]), 'en')).toBe('C');
  });
});
