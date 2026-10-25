// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteAgenda } from '@mygitnotes/core/note-query';
import { formatDateYMD } from '../lib/date-utils.js';
import { CalendarTool } from './CalendarTool.js';

const today = formatDateYMD(new Date());
const task = (id: string, lineText: string, extra: object = {}) => ({ id, notePath: 'a.md', notebookId: 'nb', noteTitle: 'Plan', lineIndex: 1, lineText, checked: false, due: today, assignees: [] as string[], ...extra });
const agenda: NoteAgenda = { revisions: {}, dated: [], milestones: [], tasks: [task('a.md#1', '- [ ] ship @小林 @alice ⏫ 📅 ' + today, { assignees: ['小林', 'alice'], priority: 'high' }), task('a.md#2', '- [ ] plain 📅 ' + today)] } as unknown as NoteAgenda;

vi.mock('../lib/use-note-queries.js', () => ({ useNoteAgenda: () => ({ agenda, loading: false, error: '' }) }));

afterEach(cleanup);

it('shows the owners and priority of each task in the day detail', () => {
  const { container } = render(createElement(CalendarTool, { notebooks: [], selectedNotebookId: 'nb', onOpenNote: vi.fn() }));
  fireEvent.click(container.querySelector(`[data-date='${today}'], [data-day='${today}']`) ?? screen.getAllByRole('button').find(button => button.textContent?.trim() === String(new Date().getDate()))!);
  const list = container.querySelector('.calendar-day-tasks') as HTMLElement;
  expect(within(list).getByText('小林')).toBeInTheDocument();
  expect(within(list).getByText('alice')).toBeInTheDocument();
  expect(list.querySelector('[data-priority="high"]')).not.toBeNull();
});
