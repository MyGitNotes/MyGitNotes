import { describe, expect, it } from 'vitest';
import { buildNewNoteDraft, livePathPrompts } from './new-note.js';

describe('buildNewNoteDraft', () => {
  it('uses a plain heading and the user tags/status when no template is selected', () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['a'], status: 'inbox', body: '在這裡寫筆記。' });
    expect(draft.content).toBe('# My Note\n\n在這裡寫筆記。\n');
    expect(draft.metadata).toEqual({ id: 'my-note', title: 'My Note', tags: ['a'] });
    expect(draft.status).toBe('inbox');
  });

  it("keeps the user's final tags and status even when the rendered template sets its own", () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['user-tag'], status: 'active', body: 'Write here.', template: { content: '# templated\n', metadata: { title: 'My Note', tags: ['template-tag'], status: 'inbox' } } });
    expect(draft.content).toBe('# templated\n');
    expect(draft.metadata.tags).toEqual(['user-tag']);
    expect(draft.status).toBe('active');
  });

  it('keeps other template metadata fields that are not tags or status', () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['user-tag'], status: 'active', body: 'Write here.', template: { content: '# templated\n', metadata: { created_on: '2026-09-16' } } });
    expect(draft.metadata).toEqual({ id: 'my-note', created_on: '2026-09-16', tags: ['user-tag'] });
  });
});

describe('livePathPrompts', () => {
  it("asks for the path's placeholders other than title, date and time, prefilled with their defaults", () => {
    const template = { path: '會議/{{kind}}/{{date}} {{title}} {{ room }}.md', placeholders: [{ name: 'kind', default: '其他', description: '會議類型' }, { name: 'room' }, { name: 'agenda', default: 'x' }] };
    expect(livePathPrompts(template)).toEqual([{ name: 'kind', default: '其他', description: '會議類型' }, { name: 'room', default: '' }]);
  });

  it('asks nothing without a path pattern, or with only title, date and time', () => {
    expect(livePathPrompts({ placeholders: [{ name: 'kind', default: 'a' }] })).toEqual([]);
    expect(livePathPrompts({ path: '{{date}} {{title}}.md', placeholders: [] })).toEqual([]);
  });
});
