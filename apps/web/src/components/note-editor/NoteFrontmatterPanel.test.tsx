// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteFrontmatterPanel, type NoteFrontmatterPanelProps } from './NoteFrontmatterPanel.js';

afterEach(cleanup);

const panel = (extra: Partial<NoteFrontmatterPanelProps> = {}) => {
  const setMetadata = vi.fn();
  const props: NoteFrontmatterPanelProps = { metadata: { title: 'Untitled', status: 'todo' }, setMetadata, statuses: ['todo'], availableTags: [], locked: false, newFieldKey: '', setNewFieldKey: vi.fn(), frontmatterViewMode: 'form', setFrontmatterViewMode: vi.fn(), yamlText: '', setYamlText: vi.fn(), yamlError: '', setYamlError: vi.fn(), tagInput: '', setTagInput: vi.fn(), isTagDropdownOpen: false, setIsTagDropdownOpen: vi.fn(), ...extra };
  render(createElement(NoteFrontmatterPanel, props));
  return { setMetadata, title: screen.getByRole('textbox', { name: 'Title' }) };
};

it('renames the note from the Title field on Enter or blur, as the note row does, and not once per keystroke', () => {
  const onRename = vi.fn();
  const { setMetadata, title } = panel({ onRename });
  fireEvent.change(title, { target: { value: 'Weekly plan' } });
  expect(title).toHaveValue('Weekly plan');
  expect(onRename).not.toHaveBeenCalled();
  fireEvent.keyDown(title, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Weekly plan');
  fireEvent.change(title, { target: { value: 'Monthly plan' } });
  fireEvent.blur(title);
  expect(onRename).toHaveBeenLastCalledWith('Monthly plan');
  // The title and the file name change together, so the field never writes the title alone.
  expect(setMetadata).not.toHaveBeenCalled();
});

it('drops an unchanged or unnameable title, and Escape reverts the field', () => {
  const onRename = vi.fn();
  const { title } = panel({ onRename });
  fireEvent.blur(title);
  fireEvent.change(title, { target: { value: '!!!' } });
  expect(screen.getByRole('status')).toHaveTextContent('at least one letter or digit');
  fireEvent.blur(title);
  fireEvent.change(title, { target: { value: 'Something else' } });
  fireEvent.keyDown(title, { key: 'Escape' });
  expect(title).toHaveValue('Untitled');
  expect(onRename).not.toHaveBeenCalled();
});

it('edits the title as a field where the note cannot be renamed', () => {
  const { setMetadata, title } = panel();
  fireEvent.change(title, { target: { value: 'Retitled' } });
  expect(setMetadata).toHaveBeenCalledWith({ title: 'Retitled', status: 'todo' });
});

it('leaves the title field disabled for a note that is locked, as in a read-only notebook', () => {
  const { title } = panel({ locked: true, onRename: vi.fn() });
  expect(title).toBeDisabled();
});
