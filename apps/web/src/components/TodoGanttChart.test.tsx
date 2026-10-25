// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TodoGanttChart } from './TodoGanttChart.js';

afterEach(cleanup);

it('shows the owners beside the bar without hovering', () => {
  const task = { id: 'a.md#1', notePath: 'a.md', notebookId: 'nb', noteTitle: 'Plan', lineIndex: 1, lineText: '- [ ] ship @小林 @alice 🛫 2026-10-26 📅 2026-10-28', checked: false, start: '2026-10-26', due: '2026-10-28', assignees: ['小林', 'alice'] };
  render(createElement(TodoGanttChart, { tasks: [task], milestones: [], today: '2026-10-26', onOpenTask: vi.fn(), onOpenMilestone: vi.fn() }));
  expect(screen.getByText('@小林 @alice')).toBeVisible();
});
