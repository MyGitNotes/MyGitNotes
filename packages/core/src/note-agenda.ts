import { DUE_EMOJI, getTaskAssignees, getTaskPriority, getTokenValue, isTaskChecked, isTaskLine, START_EMOJI, type TaskPriority } from './task-tokens.js';

export interface TodoTask {
  id: string;
  notePath: string;
  notebookId: string;
  noteTitle: string;
  lineIndex: number;
  lineText: string;
  checked: boolean;
  due?: string;
  start?: string;
  /** The `@name` assignees on the line, in order; empty when none. */
  assignees: string[];
  /** The priority emoji on the line; undefined is the normal priority. */
  priority?: TaskPriority;
}

export interface AgendaSourceNote {
  path: string;
  notebookId: string;
  title: string;
  content: string;
}

/** Extracts every GFM task line from a set of notes as flat TodoTask records. */
export function extractTodoTasks(notes: AgendaSourceNote[]): TodoTask[] {
  const tasks: TodoTask[] = [];
  for (const note of notes) {
    note.content.split('\n').forEach((lineText, lineIndex) => {
      if (!isTaskLine(lineText)) return;
      tasks.push({ id: `${note.path}#${lineIndex}`, notePath: note.path, notebookId: note.notebookId, noteTitle: note.title, lineIndex, lineText, checked: isTaskChecked(lineText) ?? false, due: getTokenValue(lineText, DUE_EMOJI), start: getTokenValue(lineText, START_EMOJI), assignees: getTaskAssignees(lineText), priority: getTaskPriority(lineText) });
    });
  }
  return tasks;
}

const MILESTONE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day (`YYYY-MM-DD`) a note marks as a milestone through its `milestone` frontmatter key, or undefined when the key
 * is absent or is not a real calendar date. `due` is left alone: it already belongs to a task's `📅` date.
 */
export function getNoteMilestone(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.milestone;
  if (typeof value !== 'string') return undefined;
  const match = MILESTONE_RE.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : undefined;
}
