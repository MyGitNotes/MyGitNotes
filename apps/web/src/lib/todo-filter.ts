import { TASK_PRIORITIES, type TaskPriority } from '@mygitnotes/core/task-tokens';
import type { TranslationKey } from './i18n/index.js';
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

/** The Priority filter's values: any task, a task with no priority emoji, or one level. */
export const ANY_PRIORITY = 'any';
export const NORMAL_PRIORITY = 'normal';

export const PRIORITY_LABEL_KEY: Record<TaskPriority, TranslationKey> = { highest: 'panel.todoPriorityHighest', high: 'panel.todoPriorityHigh', medium: 'panel.todoPriorityMedium', low: 'panel.todoPriorityLow', lowest: 'panel.todoPriorityLowest' };

export function filterTasksByPriority(tasks: TodoTask[], value: string): TodoTask[] {
  if (value === ANY_PRIORITY) return tasks;
  return tasks.filter(task => (task.priority ?? NORMAL_PRIORITY) === value);
}

export type TodoSort = 'list' | 'priority';

/** Highest first; a task with no priority is normal and sits between medium and low. */
function priorityRank(priority: TaskPriority | undefined): number {
  return priority === undefined ? TASK_PRIORITIES.indexOf('medium') + 0.5 : TASK_PRIORITIES.indexOf(priority);
}

/** A sorted copy: by priority, then by due date (undated last), then by the order given. */
export function sortTodoTasks(tasks: TodoTask[], sort: TodoSort): TodoTask[] {
  if (sort === 'list') return tasks;
  return [...tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99'));
}
