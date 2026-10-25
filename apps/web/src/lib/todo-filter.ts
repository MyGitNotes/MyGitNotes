import type { TodoTask } from './todo-list.js';

/** The People filter's values: everyone, nobody-assigned, or one person (prefixed, so a name never reads as a keyword). */
export const ALL_PEOPLE = 'all';
export const UNASSIGNED = 'unassigned';
export const personFilterValue = (name: string) => `person:${name}`;

/** Every assignee on the tasks (completed ones too), once, sorted by name. */
export function listAssignees(tasks: TodoTask[]): string[] {
  return [...new Set(tasks.flatMap(task => task.assignees))].sort((a, b) => a.localeCompare(b));
}

/** The chosen People value, or all people when that person no longer appears in the scope. */
export function resolvePersonFilter(value: string, assignees: string[]): string {
  if (value === ALL_PEOPLE || value === UNASSIGNED) return value;
  return assignees.some(name => personFilterValue(name) === value) ? value : ALL_PEOPLE;
}

export function filterTasksByPerson(tasks: TodoTask[], value: string): TodoTask[] {
  if (value === ALL_PEOPLE) return tasks;
  if (value === UNASSIGNED) return tasks.filter(task => task.assignees.length === 0);
  return tasks.filter(task => task.assignees.some(name => personFilterValue(name) === value));
}
