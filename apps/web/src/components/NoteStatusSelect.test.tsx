// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteStatusSelect, statusDotClass } from './NoteStatusSelect.js';

afterEach(cleanup);

const status = (props: Partial<Parameters<typeof NoteStatusSelect>[0]> = {}) => render(createElement(NoteStatusSelect, { status: 'done', statuses: ['inbox', 'working', 'done'], readOnly: false, onChange: vi.fn(), label: 'Status for Alpha', ...props }));

it('stays a select named for its note, showing a coloured dot and the status name', () => {
  status();
  const trigger = screen.getByRole('combobox', { name: 'Status for Alpha' });
  expect(trigger).toHaveTextContent('done');
  expect(trigger.querySelector('.status-dot')).toHaveClass('bg-success');
  expect(trigger).toHaveClass('status-cell');
});

it('gives each status its own dot colour, shared with the sidebar filter and the Kanban columns', () => {
  expect(['done', 'working', 'doing', 'todo', 'inbox', 'archived'].map(statusDotClass)).toEqual(['bg-success', 'bg-info', 'bg-info', 'bg-warning', 'bg-primary', 'bg-muted']);
});

it('shows a hollow dot and the no-status label for a note without a status', () => {
  status({ status: '' });
  const trigger = screen.getByRole('combobox', { name: 'Status for Alpha' });
  expect(trigger).toHaveTextContent('No status');
  expect(trigger.querySelector('.status-dot')).toHaveClass('status-dot-empty');
  expect(trigger).toHaveClass('status-cell-empty');
});

it('is disabled when the list is read-only', () => {
  status({ readOnly: true });
  expect(screen.getByRole('combobox', { name: 'Status for Alpha' })).toBeDisabled();
});
