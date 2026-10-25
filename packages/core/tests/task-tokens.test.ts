import { describe, expect, it } from 'vitest';
import { DUE_EMOJI, findToken, getTaskAssignees, getTaskPriority, getTokenValue, PRIORITY_EMOJI, setTaskChecked, setTokenValue, START_EMOJI, stripTaskTokens, TASK_PRIORITIES } from '../src/task-tokens.js';

describe('start-date token', () => {
  it('finds a start-date token', () => {
    const match = findToken('- [ ] Ship it 🛫 2026-09-20', START_EMOJI);
    expect(match?.value).toBe('2026-09-20');
    expect(getTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI)).toBe('2026-09-20');
  });

  it('does not confuse a start-date token for a due-date token', () => {
    expect(getTokenValue('- [ ] Ship it 🛫 2026-09-20', DUE_EMOJI)).toBeUndefined();
  });

  it('sets, replaces, and clears a start-date token like the due-date token', () => {
    expect(setTokenValue('- [ ] Ship it', START_EMOJI, '2026-09-20')).toBe('- [ ] Ship it 🛫 2026-09-20');
    expect(setTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI, '2026-09-25')).toBe('- [ ] Ship it 🛫 2026-09-25');
    expect(setTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI, null)).toBe('- [ ] Ship it');
  });

  it('coexists with a due-date token on the same line', () => {
    const line = setTokenValue(setTokenValue('- [ ] Ship it', START_EMOJI, '2026-09-20'), DUE_EMOJI, '2026-09-25');
    expect(line).toBe('- [ ] Ship it 🛫 2026-09-20 📅 2026-09-25');
    expect(getTokenValue(line, START_EMOJI)).toBe('2026-09-20');
    expect(getTokenValue(line, DUE_EMOJI)).toBe('2026-09-25');
  });
});

describe('stripTaskTokens', () => {
  it('removes the checkbox marker and every recognized date token', () => {
    expect(stripTaskTokens('- [ ] Ship it 🛫 2026-09-20 📅 2026-09-25')).toBe('Ship it');
    expect(stripTaskTokens('- [x] Done thing ✅ 2026-09-15')).toBe('Done thing');
  });

  it('leaves plain task text unchanged aside from the marker', () => {
    expect(stripTaskTokens('- [ ] Plain task')).toBe('Plain task');
  });

  it('strips a timestamp token even without a checkbox context change', () => {
    expect(stripTaskTokens('- [ ] Logged 🕒 2026-09-15 14:32')).toBe('Logged');
  });
});

describe('getTaskAssignees', () => {
  it('reads an @name after the checkbox, at the start or after whitespace', () => {
    expect(getTaskAssignees('- [ ] @alice write the spec')).toEqual(['alice']);
    expect(getTaskAssignees('- [ ] write the spec @alice')).toEqual(['alice']);
    expect(getTaskAssignees('- [x] Review @bob 📅 2026-10-30')).toEqual(['bob']);
  });

  it('reads several assignees in order and counts a repeated one once', () => {
    expect(getTaskAssignees('- [ ] pair on it @alice @bob @alice')).toEqual(['alice', 'bob']);
  });

  it('reads Chinese names and names with an inner dot, dash or underscore', () => {
    expect(getTaskAssignees('- [ ] 寫規格 @小林 @王小明')).toEqual(['小林', '王小明']);
    expect(getTaskAssignees('- [ ] ship @j.doe @mary-ann @dev_ops2')).toEqual(['j.doe', 'mary-ann', 'dev_ops2']);
  });

  it('leaves sentence punctuation out of the name', () => {
    expect(getTaskAssignees('- [ ] ask @alice.')).toEqual(['alice']);
    expect(getTaskAssignees('- [ ] ask @alice, then @bob: ok')).toEqual(['alice', 'bob']);
    expect(getTaskAssignees('- [ ] ask @小林，再問 @小美。')).toEqual(['小林', '小美']);
  });

  it('ignores an @ that is part of an email, a URL or a scoped package', () => {
    expect(getTaskAssignees('- [ ] mail alice@example.com')).toEqual([]);
    expect(getTaskAssignees('- [ ] see https://example.com/@alice and http://x.test/?to=@bob')).toEqual([]);
    expect(getTaskAssignees('- [ ] upgrade @types/node and @scope/pkg')).toEqual([]);
    expect(getTaskAssignees('- [ ] edit `@alice` or (@bob)')).toEqual([]);
  });

  it('finds none on a line without a name and none on a non-task line', () => {
    expect(getTaskAssignees('- [ ] plain task')).toEqual([]);
    expect(getTaskAssignees('- [ ] lone @ sign and @ ')).toEqual([]);
    expect(getTaskAssignees('@alice not a task')).toEqual([]);
  });
});

describe('assignees in stripTaskTokens', () => {
  it('removes assignee tokens from the display text', () => {
    expect(stripTaskTokens('- [ ] @alice write the spec 📅 2026-10-30')).toBe('write the spec');
    expect(stripTaskTokens('- [ ] write @alice @bob the spec')).toBe('write the spec');
    expect(stripTaskTokens('- [ ] ask @alice.')).toBe('ask.');
  });

  it('keeps an email and a URL in the text', () => {
    expect(stripTaskTokens('- [ ] mail alice@example.com')).toBe('mail alice@example.com');
  });
});

describe('toggling a task keeps its assignee tokens', () => {
  it('checks and unchecks without touching @names', () => {
    const line = '- [ ] @小林 write the spec @alice 📅 2026-10-30';
    const checked = setTaskChecked(line, true, '2026-10-25');
    expect(checked).toBe('- [x] @小林 write the spec @alice 📅 2026-10-30 ✅ 2026-10-25');
    expect(setTaskChecked(checked, false, '2026-10-25')).toBe(line);
  });
});

describe('getTaskPriority', () => {
  it('reads the Obsidian Tasks priority emojis', () => {
    expect(getTaskPriority('- [ ] Ship 🔺')).toBe('highest');
    expect(getTaskPriority('- [ ] Ship ⏫')).toBe('high');
    expect(getTaskPriority('- [ ] Ship 🔼')).toBe('medium');
    expect(getTaskPriority('- [ ] Ship 🔽')).toBe('low');
    expect(getTaskPriority('- [ ] Ship ⏬')).toBe('lowest');
  });

  it('is undefined (normal) without an emoji, and reads one anywhere on the line beside the other tokens', () => {
    expect(getTaskPriority('- [ ] Ship it')).toBeUndefined();
    expect(getTaskPriority('- [ ] ⏫ Ship it 📅 2026-10-30')).toBe('high');
    expect(getTaskPriority('- [ ] @alice Ship it 🛫 2026-10-20 📅 2026-10-30 🔺')).toBe('highest');
    expect(getTaskPriority('- [ ] Ship it ⏫\uFE0F')).toBe('high');
  });

  it('takes the first emoji when a line has several, and none from a line that is not a task', () => {
    expect(getTaskPriority('- [ ] Ship 🔽 or ⏫')).toBe('low');
    expect(getTaskPriority('⏫ not a task')).toBeUndefined();
  });

  it('names every level with its emoji, highest first', () => {
    expect(TASK_PRIORITIES.map(level => PRIORITY_EMOJI[level])).toEqual(['🔺', '⏫', '🔼', '🔽', '⏬']);
  });
});

describe('priority in stripTaskTokens and task toggling', () => {
  it('removes the emoji from the display text and keeps the rest', () => {
    expect(stripTaskTokens('- [ ] ⏫ Ship it 📅 2026-10-30')).toBe('Ship it');
    expect(stripTaskTokens('- [ ] Ship it 🔺 @alice')).toBe('Ship it');
    expect(stripTaskTokens('- [ ] Ship⏫ it')).toBe('Ship it');
  });

  it('keeps the emoji when a task is checked and unchecked', () => {
    const line = '- [ ] Ship it ⏫ @alice 📅 2026-10-30';
    const checked = setTaskChecked(line, true, '2026-10-25');
    expect(checked).toBe('- [x] Ship it ⏫ @alice 📅 2026-10-30 ✅ 2026-10-25');
    expect(setTaskChecked(checked, false, '2026-10-25')).toBe(line);
  });
});
