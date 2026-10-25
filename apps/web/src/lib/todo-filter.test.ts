import { describe, expect, it } from 'vitest';
import type { NoteItem } from './types.js';
import { extractTodoTasks } from './todo-list.js';
import { ALL_PEOPLE, filterTasksByPerson, listAssignees, personFilterValue, resolvePersonFilter, UNASSIGNED } from './todo-filter.js';

function tasksOf(...lines: string[]) {
  const note: NoteItem = { id: 'a.md', path: 'a.md', notebookId: 'nb', title: 'a', tags: [], metadata: {}, content: lines.join('\n') };
  return extractTodoTasks([note]);
}

describe('listAssignees', () => {
  it('lists every assignee once, sorted by name, counting completed tasks too', () => {
    const tasks = tasksOf('- [ ] one @bob @alice', '- [x] two @小林', '- [ ] three @alice', '- [ ] none');
    expect(listAssignees(tasks)).toEqual(['alice', 'bob', '小林']);
  });

  it('is empty when no task is assigned', () => {
    expect(listAssignees(tasksOf('- [ ] plain'))).toEqual([]);
  });
});

describe('filterTasksByPerson', () => {
  const tasks = tasksOf('- [ ] a @alice', '- [ ] b @bob @alice', '- [x] c @bob', '- [ ] d');

  it('keeps everything for all people', () => {
    expect(filterTasksByPerson(tasks, ALL_PEOPLE)).toHaveLength(4);
  });

  it('keeps the tasks one person is among the assignees of, completed ones included', () => {
    expect(filterTasksByPerson(tasks, personFilterValue('alice')).map(task => task.lineText)).toEqual(['- [ ] a @alice', '- [ ] b @bob @alice']);
    expect(filterTasksByPerson(tasks, personFilterValue('bob')).map(task => task.lineText)).toEqual(['- [ ] b @bob @alice', '- [x] c @bob']);
  });

  it('keeps the tasks nobody is assigned to', () => {
    expect(filterTasksByPerson(tasks, UNASSIGNED).map(task => task.lineText)).toEqual(['- [ ] d']);
  });
});

describe('resolvePersonFilter', () => {
  it('falls back to all people when the chosen person is no longer in scope', () => {
    expect(resolvePersonFilter(personFilterValue('carol'), ['alice', 'bob'])).toBe(ALL_PEOPLE);
    expect(resolvePersonFilter(personFilterValue('bob'), ['alice', 'bob'])).toBe(personFilterValue('bob'));
    expect(resolvePersonFilter(UNASSIGNED, [])).toBe(UNASSIGNED);
  });

  it('does not confuse a person named like a keyword with the keyword', () => {
    expect(personFilterValue('unassigned')).not.toBe(UNASSIGNED);
    expect(personFilterValue('all')).not.toBe(ALL_PEOPLE);
  });
});
