import { expect, it } from 'vitest';
import { phoneNotesScreen } from './phone-notes.js';

const screenOf = (state: Partial<Parameters<typeof phoneNotesScreen>[0]>) => phoneNotesScreen({ hasFocus: true, hasActiveTab: true, view: 'focus', ...state });

it('shows a note only when the Focus has a tab to show and the person has not gone back to the list', () => {
  expect(screenOf({})).toBe('note');
  expect(screenOf({ view: 'browse' })).toBe('list');
  expect(screenOf({ hasActiveTab: false })).toBe('list');
  expect(screenOf({ hasFocus: false })).toBe('list');
});
