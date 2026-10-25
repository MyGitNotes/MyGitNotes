// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setThemeChoice } from '../lib/themes.js';
import '@testing-library/jest-dom/vitest';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { StatusColorProvider, statusDotClass } from '../lib/status-color.js';

afterEach(() => {
  cleanup();
  setThemeChoice({ familyId: 'flexoki', mode: 'system' });
});

const status = (props: Partial<Parameters<typeof NoteStatusSelect>[0]> = {}) => render(createElement(NoteStatusSelect, { status: 'done', statuses: ['inbox', 'working', 'done'], readOnly: false, onChange: vi.fn(), label: 'Status for Alpha', ...props }));

it('stays a select named for its note, showing a coloured dot and the status name', () => {
  status();
  const trigger = screen.getByRole('combobox', { name: 'Status for Alpha' });
  expect(trigger).toHaveTextContent('done');
  expect(trigger.querySelector('.status-dot')).toHaveClass('bg-success');
  expect(trigger).toHaveClass('status-cell');
});

const dot = (props: Partial<Parameters<typeof NoteStatusSelect>[0]>, notebookStatuses: Parameters<typeof StatusColorProvider>[0]['statuses'] = []) => {
  render(
    <StatusColorProvider statuses={notebookStatuses}>
      <NoteStatusSelect status='done' statuses={[]} readOnly={false} onChange={vi.fn()} label='Status for Alpha' {...props} />
    </StatusColorProvider>,
  );
  return screen.getByRole('combobox', { name: 'Status for Alpha' }).querySelector('.status-dot');
};

it('keeps the known names on their familiar dot colours', () => {
  const classes = ['done', 'working', 'doing', 'todo', 'inbox', 'archived'].map(status => {
    cleanup();
    return [...dot({ status })!.classList].find(name => name.startsWith('bg-'));
  });
  expect(classes).toEqual(['bg-success', 'bg-info', 'bg-info', 'bg-warning', 'bg-primary', 'bg-muted']);
});

it('paints the colour a notebook gives a status', () => {
  expect(dot({ status: 'review' }, ['inbox', { name: 'review', color: 'purple' }])).toHaveClass('bg-status-purple');
});

it('cycles the palette for an uncoloured custom status and mutes one the notebook does not list', () => {
  const list = ['inbox', 'capture', 'review'];
  expect(dot({ status: 'review' }, list)).toHaveClass('bg-status-pink');
  cleanup();
  expect(dot({ status: 'stray' }, list)).toHaveClass('bg-muted');
});

it('skips the cycle colour closest to the theme primary, so no cycled status looks like an inbox', () => {
  const list = ['inbox', 'capture', 'review'];
  expect(dot({ status: 'review' }, list)).toHaveClass('bg-status-pink');
  cleanup();
  setThemeChoice({ familyId: 'catppuccin', mode: 'dark' });
  expect(dot({ status: 'capture' }, list)).toHaveClass('bg-status-teal');
  cleanup();
  expect(dot({ status: 'inbox' }, list)).toHaveClass('bg-primary');
});

it('has a themed class for every palette colour', () => {
  expect(['green', 'blue', 'amber', 'red', 'purple', 'teal', 'pink', 'gray', 'primary', 'muted'].map(color => statusDotClass(color as Parameters<typeof statusDotClass>[0]))).toEqual(['bg-success', 'bg-info', 'bg-warning', 'bg-danger', 'bg-status-purple', 'bg-status-teal', 'bg-status-pink', 'bg-status-gray', 'bg-primary', 'bg-muted']);
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
