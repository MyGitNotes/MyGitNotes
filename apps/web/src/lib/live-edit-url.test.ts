import { describe, expect, it } from 'vitest';
import { asksLiveEdit, searchWithoutLiveEdit } from './live-edit-url.js';

describe('the ?edit request of a note address', () => {
  it('is asked bare or with any value', () => {
    for (const search of ['?edit', '?edit=', '?edit=1', '?edit=0', '?zoom&edit', '?q=x&edit=yes&mode=split', 'edit']) expect(asksLiveEdit(search)).toBe(true);
  });

  it('is not the list filter live=, the editor mode, or another parameter that starts the same', () => {
    for (const search of ['', '?live=editing&live=pending', '?mode=split', '?editor=a', '?q=edit', '?zoom']) expect(asksLiveEdit(search)).toBe(false);
  });

  it('is taken out keeping every other part as written, in its order', () => {
    expect(searchWithoutLiveEdit('?zoom&edit&mode=split')).toBe('?zoom&mode=split');
    expect(searchWithoutLiveEdit('?q=a+b&edit=1&live=editing&live=pending')).toBe('?q=a+b&live=editing&live=pending');
    expect(searchWithoutLiveEdit('?edit&tag=%E4%B8%AD&edit=2')).toBe('?tag=%E4%B8%AD');
  });

  it('leaves no query when it was the only part, and a query without it unchanged', () => {
    expect(searchWithoutLiveEdit('?edit')).toBe('');
    expect(searchWithoutLiveEdit('?q=x&editor=a')).toBe('?q=x&editor=a');
    expect(searchWithoutLiveEdit('')).toBe('');
  });
});
