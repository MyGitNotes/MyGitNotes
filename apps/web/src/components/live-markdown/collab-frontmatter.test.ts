import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { collabFrontmatter, frontmatterEnd } from './collab-frontmatter.js';

// FM-F002: the collab editor reads a leading `---` as core does: a block only when what follows looks like YAML.
describe('collabFrontmatter', () => {
  const read = (doc: string) => collabFrontmatter(EditorState.create({ doc }));
  it.each(['---\n\nHR body\n', '---\r\n\r\nHR body\r\n', '---\nIntro after a rule\n'])('finds no block in a note opening with a rule: %j', doc => {
    expect(read(doc)).toBeNull();
    expect(frontmatterEnd(EditorState.create({ doc }))).toBe(0);
  });

  it('shows an unclosed block that looks like YAML raw, and hides a readable one', () => {
    expect(read('---\ntitle: x\nBody\n')).toMatchObject({ valid: false });
    expect(read('---\ntitle: x\n---\n\nBody\n')).toEqual({ end: 17, bodyStart: 18, valid: true });
  });
});
