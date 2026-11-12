import { describe, expect, it } from 'vitest';
import { isSlideNote } from './note.js';

describe('a slide note', () => {
  it('is a note whose frontmatter says type: slide, whatever its slideOptions say', () => {
    expect(isSlideNote({ type: 'slide' })).toBe(true);
    expect(isSlideNote({ type: 'slide', slideOptions: { engine: 'reveal', structure: 'slides' } })).toBe(true);
    expect(isSlideNote({ type: 'slide', slideOptions: { structure: '' } })).toBe(true);
  });

  it('is no other note', () => {
    expect(isSlideNote(undefined)).toBe(false);
    expect(isSlideNote({ type: 'note', slideOptions: { structure: 'headings' } })).toBe(false);
  });
});
