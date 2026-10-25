export const DUE_EMOJI = '📅';
export const DONE_EMOJI = '✅';
export const TIMESTAMP_EMOJI = '🕒';
export const START_EMOJI = '🛫';

const TASK_MARKER_RE = /^(\s*[-*+]\s\[)([ xX])(\]\s?)/;
const TASK_DATE_TOKENS: [string, boolean][] = [[DUE_EMOJI, false], [DONE_EMOJI, false], [START_EMOJI, false], [TIMESTAMP_EMOJI, true]];
const DATE_VALUE = '\\d{4}-\\d{2}-\\d{2}';
const DATE_TIME_VALUE = `${DATE_VALUE} \\d{2}:\\d{2}`;

const NAME_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
// A name runs letters/numbers/_ with `.` or `-` only between them, so sentence punctuation stays outside it. The
// lookahead refuses a name that is only the front of a longer path, package or address (`@types/node`, `@a.b/c`).
const ASSIGNEE_SOURCE = `@(${NAME_CHAR}+(?:[.-]${NAME_CHAR}+)*)(?!${NAME_CHAR}|[/@]|[.-](?:${NAME_CHAR}|[/@]))`;

export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/** The levels, highest first. A line with no priority emoji is normal, which ranks between medium and low. */
export const TASK_PRIORITIES: readonly TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

/** Obsidian Tasks' priority emojis. */
export const PRIORITY_EMOJI: Record<TaskPriority, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };

const PRIORITY_SOURCE = `(${TASK_PRIORITIES.map(level => PRIORITY_EMOJI[level]).join('|')})\\uFE0F?`;

export interface TokenMatch {
  start: number;
  end: number;
  leadingSpace: string;
  value: string;
}

function tokenRegExp(emoji: string, withTime: boolean): RegExp {
  const value = withTime ? DATE_TIME_VALUE : DATE_VALUE;
  return new RegExp(`(\\s?)${emoji}\\s*(${value})`, 'u');
}

/** Finds a `<emoji> <value>` token in a line, if present. */
export function findToken(line: string, emoji: string, withTime = false): TokenMatch | null {
  const match = tokenRegExp(emoji, withTime).exec(line);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length, leadingSpace: match[1], value: match[2] };
}

export function getTokenValue(line: string, emoji: string, withTime = false): string | undefined {
  return findToken(line, emoji, withTime)?.value;
}

/**
 * Sets, replaces, or (when `value` is `null`) removes a `<emoji> <value>`
 * token on a line. A new token is appended at the end of the line.
 */
export function setTokenValue(line: string, emoji: string, value: string | null, withTime = false): string {
  const found = findToken(line, emoji, withTime);
  if (value === null) {
    if (!found) return line;
    return (line.slice(0, found.start) + line.slice(found.end)).replace(/[ \t]+$/, '');
  }
  if (found) {
    return line.slice(0, found.start) + `${found.leadingSpace}${emoji} ${value}` + line.slice(found.end);
  }
  return `${line.replace(/\s+$/, '')} ${emoji} ${value}`;
}

export function isTaskLine(line: string): boolean {
  return TASK_MARKER_RE.test(line);
}

/**
 * The `@name` assignees of a task line, in order of appearance without repeats. An `@` counts only at the start of the
 * task's text or after whitespace, so an email, a URL or a scoped package is not an assignee.
 */
export function getTaskAssignees(line: string): string[] {
  if (!isTaskLine(line)) return [];
  const text = line.replace(TASK_MARKER_RE, '');
  const names = [...text.matchAll(new RegExp(`(?<![^\\s])${ASSIGNEE_SOURCE}`, 'gu'))].map(match => match[1]);
  return [...new Set(names)];
}

/** The priority emoji on a task line (the first when there are several), or undefined for a normal-priority task. */
export function getTaskPriority(line: string): TaskPriority | undefined {
  if (!isTaskLine(line)) return undefined;
  const emoji = new RegExp(PRIORITY_SOURCE, 'u').exec(line.replace(TASK_MARKER_RE, ''))?.[1];
  return TASK_PRIORITIES.find(level => PRIORITY_EMOJI[level] === emoji);
}

/** Removes the checkbox marker and every recognized token (dates, assignees, priority), leaving just the task's text. */
export function stripTaskTokens(line: string): string {
  let text = line.replace(TASK_MARKER_RE, '');
  for (const [emoji, withTime] of TASK_DATE_TOKENS) text = setTokenValue(text, emoji, null, withTime);
  text = text.replace(new RegExp(`(^|\\s+)${ASSIGNEE_SOURCE}`, 'gu'), '').replace(new RegExp(`\\s*${PRIORITY_SOURCE}`, 'gu'), '');
  return text.trim();
}

export function isTaskChecked(line: string): boolean | undefined {
  const match = TASK_MARKER_RE.exec(line);
  if (!match) return undefined;
  return match[2].toLowerCase() === 'x';
}

/**
 * Flips a task line's checkbox and adds/removes its done-date token
 * (`✅ YYYY-MM-DD`) to match, per the checked state.
 */
export function setTaskChecked(line: string, checked: boolean, doneDate: string): string {
  const match = TASK_MARKER_RE.exec(line);
  if (!match) return line;
  const markerStart = match[1].length;
  const flipped = line.slice(0, markerStart) + (checked ? 'x' : ' ') + line.slice(markerStart + 1);
  return setTokenValue(flipped, DONE_EMOJI, checked ? doneDate : null);
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'noDate';

/** Classifies a due-date string (`YYYY-MM-DD`) against today's date, also `YYYY-MM-DD`. */
export function classifyDueDate(due: string | undefined, today: string): TodoGroup {
  if (!due) return 'noDate';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}
