import { describe, expect, it } from 'vitest';
import { isSlideNote, readsByHeadings, slideStructureOf } from './note.js';

describe('the structure of a slide note', () => {
  it('is none for a note that is no slide note, whatever its slideOptions say', () => {
    expect(slideStructureOf(undefined)).toBeUndefined();
    expect(slideStructureOf({ type: 'note', slideOptions: { structure: 'headings' } })).toBeUndefined();
    expect(isSlideNote({ type: 'note' })).toBe(false);
  });

  it('is slides unless the frontmatter names another', () => {
    expect(slideStructureOf({ type: 'slide' })).toBe('slides');
    expect(slideStructureOf({ type: 'slide', slideOptions: { engine: 'reveal' } })).toBe('slides');
    expect(slideStructureOf({ type: 'slide', slideOptions: { structure: null } })).toBe('slides');
    expect(slideStructureOf({ type: 'slide', slideOptions: 'headings' })).toBe('slides');
    expect(readsByHeadings(slideStructureOf({ type: 'slide' }))).toBe(false);
  });

  it('is headings for slideOptions.structure: headings', () => {
    expect(slideStructureOf({ type: 'slide', slideOptions: { structure: 'headings' } })).toBe('headings');
    expect(readsByHeadings('headings')).toBe(true);
  });

  it('hands on a value contour-deck does not know as it is written, to be refused there', () => {
    expect(slideStructureOf({ type: 'slide', slideOptions: { structure: 'heading' } })).toBe('heading');
    expect(slideStructureOf({ type: 'slide', slideOptions: { structure: 2 } })).toBe('2');
    expect(readsByHeadings('heading')).toBe(false);
  });
});
