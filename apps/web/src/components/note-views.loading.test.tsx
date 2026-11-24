// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { FocusNoteList } from './FocusNoteList.js';
afterEach(cleanup);
const props = { notes: [], uncommitted: [], statuses: [], onOpenNote: () => {}, onDeleteNote: () => {}, onUpdateNoteStatus: () => {}, onNewNote: () => {} };
describe('the list with nothing to show', () => {
  it('waits for the first page instead of announcing that nothing was found', () => {
    render(
      <I18nProvider>
        <FocusNoteList {...props} loading />
      </I18nProvider>,
    );
    expect(screen.queryByText('No notes found')).toBeNull();
  });
  it('announces the empty result once the page has arrived', () => {
    render(
      <I18nProvider>
        <FocusNoteList {...props} />
      </I18nProvider>,
    );
    expect(screen.getByText('No notes found')).toBeTruthy();
  });
});
