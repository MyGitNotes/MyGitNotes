import { describe, expect, it } from 'vitest';
import type { NoteItem } from './types.js';
import { extractTodoTasks } from './todo-list.js';
import { ALL_PEOPLE, ANY_PRIORITY, filterTasksByPerson, filterTasksByPriority, listAssignees, NORMAL_PRIORITY, personFilterValue, resolvePersonFilter, sortTodoTasks, UNASSIGNED } from './todo-filter.js';

function tasksOf(...lines: string[]) {
  const note: NoteItem = { id: 'a.md', path: 'a.md', notebookId: 'nb', title: 'a', tags: [], metadata: {}, content: lines.join('\n') };
  return extractTodoTasks([note]);
}

describe('listAssignees', () => {
  it('lists every assignee once, sorted by name, counting completed tasks too', () => {
    const tasks = tasksOf('- [ ] one @bob @alice', '- [x] two @小林', '- [ ] three @alice', '- [ ] none');
    expect(listAssignees(tasks)).toEqual(['alice', 'bob', '小林']);
  });

  it('copes with a cached task that predates assignees', () => {
    const old = { ...tasksOf('- [ ] plain')[0] } as Partial<ReturnType<typeof tasksOf>[number]>;
    delete old.assignees;
    expect(listAssignees([old as ReturnType<typeof tasksOf>[number]])).toEqual([]);
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

describe('filterTasksByPriority', () => {
  const tasks = tasksOf('- [ ] a 🔺', '- [ ] b ⏫', '- [x] c ⏫', '- [ ] d', '- [ ] e ⏬');

  it('keeps everything for any priority', () => {
    expect(filterTasksByPriority(tasks, ANY_PRIORITY)).toHaveLength(5);
  });

  it('keeps the tasks of one level, completed ones included', () => {
    expect(filterTasksByPriority(tasks, 'high').map(task => task.lineText)).toEqual(['- [ ] b ⏫', '- [x] c ⏫']);
    expect(filterTasksByPriority(tasks, 'lowest').map(task => task.lineText)).toEqual(['- [ ] e ⏬']);
  });

  it('keeps the tasks with no priority emoji as normal', () => {
    expect(filterTasksByPriority(tasks, NORMAL_PRIORITY).map(task => task.lineText)).toEqual(['- [ ] d']);
  });
});

describe('sortTodoTasks', () => {
  const tasks = tasksOf('- [ ] normal late 📅 2026-10-30', '- [ ] low ⏬ 📅 2026-10-01', '- [ ] high late ⏫ 📅 2026-10-30', '- [ ] highest 🔺', '- [ ] high early ⏫ 📅 2026-10-02', '- [ ] normal early 📅 2026-10-03', '- [ ] medium 🔼', '- [ ] light 🔽');

  it('keeps list order for the list sort', () => {
    expect(sortTodoTasks(tasks, 'list')).toEqual(tasks);
  });

  it('orders by priority highest first with normal between medium and low, then by due date, then by list order', () => {
    expect(sortTodoTasks(tasks, 'priority').map(task => task.lineText.slice(6).split(/ [📅🔺⏫🔼🔽⏬]/u)[0])).toEqual(['highest', 'high early', 'high late', 'medium', 'normal early', 'normal late', 'light', 'low']);
  });

  it('does not reorder the tasks it was given', () => {
    const before = tasks.map(task => task.id);
    sortTodoTasks(tasks, 'priority');
    expect(tasks.map(task => task.id)).toEqual(before);
  });
});
