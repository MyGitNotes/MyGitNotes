// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setThemeChoice } from '../lib/themes.js';
import '@testing-library/jest-dom/vitest';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { StatusColorProvider, statusDotClass } from '../lib/status-color.js';
import { I18nProvider } from '../lib/i18n/index.js';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('github-notes:language');
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

const inLanguage = (language: string, statuses: Parameters<typeof StatusColorProvider>[0]['statuses'], props: Partial<Parameters<typeof NoteStatusSelect>[0]> = {}) => {
  window.localStorage.setItem('github-notes:language', language);
  return render(
    <I18nProvider>
      <StatusColorProvider statuses={statuses}>
        <NoteStatusSelect status='working' statuses={['inbox', 'working', 'review']} readOnly={false} onChange={vi.fn()} label='Status for Alpha' {...props} />
      </StatusColorProvider>
    </I18nProvider>,
  );
};

it('shows the notebook label for the UI language in the trigger and the menu, and still stores the name', () => {
  const onChange = vi.fn();
  const statuses = [{ name: 'working', label: { en: 'In progress', 'zh-TW': '進行中（自訂）' } }, { name: 'review', label: '審核中' }];
  const view = inLanguage('zh-TW', statuses, { onChange });
  const trigger = screen.getByRole('combobox', { name: 'Status for Alpha' });
  expect(trigger).toHaveTextContent('進行中（自訂）');
  fireEvent.click(trigger);
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['無狀態', '收件匣', '進行中（自訂）', '審核中']);
  fireEvent.click(screen.getByRole('option', { name: '審核中' }));
  expect(onChange).toHaveBeenCalledWith('review');
  view.unmount();
  inLanguage('en', statuses);
  expect(screen.getByRole('combobox', { name: 'Status for Alpha' })).toHaveTextContent('In progress');
});

it('translates the built-in statuses for a notebook without labels and leaves custom ones as written', () => {
  inLanguage('zh-TW', ['inbox', 'working', 'review'], { status: 'review' });
  expect(screen.getByRole('combobox', { name: 'Status for Alpha' })).toHaveTextContent('review');
  cleanup();
  inLanguage('zh-TW', ['inbox', 'working', 'review'], { status: 'inbox' });
  expect(screen.getByRole('combobox', { name: 'Status for Alpha' })).toHaveTextContent('收件匣');
});
