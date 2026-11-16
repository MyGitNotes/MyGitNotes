import { describe, expect, it } from 'vitest';
import { chooseOutlineHeading, findOutlineIndexForLine, findTextMatches, noteSection, parseMarkdownOutline } from './note-navigation.js';

describe('note editor navigation', () => {
  it('finds every case-insensitive, non-overlapping text match', () => {
    expect(findTextMatches('Needle and needle; NEEDLE.', 'needle')).toEqual([{ from: 0, to: 6 }, { from: 11, to: 17 }, { from: 19, to: 25 }]);
    expect(findTextMatches('aaaa', 'aa')).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
    expect(findTextMatches('text', '  ')).toEqual([]);
  });

  it('builds an outline from ATX and setext headings while ignoring fenced code', () => {
    const markdown = ['# Title', '', 'Introduction', '============', '', '```md', '## Not a heading', '```', '', '### **Details** `code` ###'].join('\n');

    expect(parseMarkdownOutline(markdown)).toEqual([{ depth: 1, label: 'Title', line: 1, from: 0 }, { depth: 1, label: 'Introduction', line: 3, from: 9 }, { depth: 3, label: 'Details code', line: 10, from: 64 }]);
  });

  it('selects the heading containing the current visible line', () => {
    const outline = [{ depth: 1, label: 'Title', line: 2, from: 1 }, { depth: 2, label: 'Middle', line: 12, from: 80 }, { depth: 2, label: 'End', line: 30, from: 240 }];

    expect(findOutlineIndexForLine(outline, 1)).toBe(0);
    expect(findOutlineIndexForLine(outline, 2)).toBe(0);
    expect(findOutlineIndexForLine(outline, 20)).toBe(1);
    expect(findOutlineIndexForLine(outline, 99)).toBe(2);
    expect(findOutlineIndexForLine([], 20)).toBe(0);
  });

  describe('chooseOutlineHeading', () => {
    const outline = [{ depth: 1, label: 'Section 1', line: 5, from: 10 }, { depth: 2, label: 'Section 2', line: 25, from: 100 }];

    it('keeps the tool panel open by default when selecting an outline item', () => {
      const result = chooseOutlineHeading(outline, 1);
      expect(result).toEqual({ heading: outline[1], line: 25, shouldClosePanel: false, focusEditor: false });
    });

    it('allows closing panel only when explicitly specified', () => {
      const result = chooseOutlineHeading(outline, 0, { closeAfter: true });
      expect(result).toEqual({ heading: outline[0], line: 5, shouldClosePanel: true, focusEditor: false });
    });

    it('returns null when index is out of bounds', () => {
      expect(chooseOutlineHeading(outline, -1)).toBeNull();
      expect(chooseOutlineHeading(outline, 5)).toBeNull();
    });
  });
});

describe('note sections', () => {
  const weekly = ['# 2025 weekly', '', 'Intro.', '', '## 2025-08-26 週會', '', 'First meeting.', '', '### Action items', '', '- one', '', '## 2025-09-02 週會', '', 'Second meeting.', '', '```md', '## 2025-09-09 週會', '```', '', '# Appendix', 'End.'].join('\n');
  it('takes the section from the heading to the next one of the same or a higher level, keeping deeper sub-headings and leaving out the heading line and the blank lines around the body', () => {
    expect(noteSection(weekly, '2025-08-26 週會')).toEqual({ heading: '2025-08-26 週會', depth: 2, body: 'First meeting.\n\n### Action items\n\n- one' });
    expect(noteSection(weekly, '2025-09-02 週會')).toEqual({ heading: '2025-09-02 週會', depth: 2, body: 'Second meeting.\n\n```md\n## 2025-09-09 週會\n```' });
    expect(noteSection(weekly, 'Appendix')?.body).toBe('End.');
  });
  it('keeps the underline of a setext heading whose text starts with # out of the body (REV-F002)', () => {
    expect(noteSection('#tag\n====\nbody A\n\n# Next\nx', '#tag')?.body).toBe('body A');
  });
  it('matches a CJK anchor by its text and by its slug', () => {
    expect(noteSection(weekly, '2025-08-26-週會')?.heading).toBe('2025-08-26 週會');
    expect(noteSection(weekly, '## 2025-08-26 週會')?.heading).toBe('2025-08-26 週會');
  });
  it('takes the first of two headings with the same text, and never one inside a code fence', () => {
    expect(noteSection('## Notes\n\nfirst\n\n## Notes\n\nsecond', 'Notes')?.body).toBe('first');
    expect(noteSection(weekly, '2025-09-09 週會')).toBeNull();
  });
  it('reads setext headings, and returns null when no heading matches', () => {
    expect(noteSection('Part one\n========\n\nBody one.\n\nPart two\n--------\n\nBody two.\n\nPart three\n==========\n\nBody three.', 'Part one')).toEqual({ heading: 'Part one', depth: 1, body: 'Body one.\n\nPart two\n--------\n\nBody two.' });
    expect(noteSection(weekly, 'Gone')).toBeNull();
  });
});
