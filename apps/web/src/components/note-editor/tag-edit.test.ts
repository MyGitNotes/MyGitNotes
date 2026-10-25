import { expect, it } from 'vitest';
import { cleanTag, noteTags, suggestTags, withoutTag, withTag } from './tag-edit.js';

it('reads the tags of a note as strings, none when the field is not a list', () => {
  expect(noteTags({ tags: ['a', 2] })).toEqual(['a', '2']);
  expect(noteTags({ tags: 'a' })).toEqual([]);
  expect(noteTags({})).toEqual([]);
});

it('adds a typed tag without the commas the separator key leaves, and keeps the metadata when it is empty or listed', () => {
  expect(cleanTag(' ,plan, ')).toBe('plan');
  expect(withTag({ title: 'T', tags: ['a'] }, ' ,b, ')).toEqual({ title: 'T', tags: ['a', 'b'] });
  const metadata = { tags: ['a'] };
  expect(withTag(metadata, 'a')).toBe(metadata);
  expect(withTag(metadata, ' , ')).toBe(metadata);
  expect(withTag({}, 'first')).toEqual({ tags: ['first'] });
});

it('removes a tag, and suggests the notebook\'s tags the note lacks that contain what is typed', () => {
  expect(withoutTag({ tags: ['a', 'b'] }, 'a')).toEqual({ tags: ['b'] });
  expect(suggestTags(['alpha', 'beta', 'Gamma'], ['alpha'], '')).toEqual(['beta', 'Gamma']);
  expect(suggestTags(['alpha', 'beta', 'Gamma'], [], ' GAM ')).toEqual(['Gamma']);
});
