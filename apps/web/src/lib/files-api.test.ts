import { describe, expect, it } from 'vitest';
import { liveLeftMessage } from './files-api.js';
import { en } from './i18n/index.js';

const t = (key: keyof typeof en, params: Record<string, string | number> = {}) => en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));

describe('liveLeftMessage', () => {
  it('says nothing when a move took every live note along', () => {
    expect(liveLeftMessage(undefined, t)).toBeNull();
    expect(liveLeftMessage([], t)).toBeNull();
  });

  it('names the live notes that stayed, and those whose links to the notes moved still lead where they were (LMR-F003)', () => {
    const message = liveLeftMessage([{ path: 'a.md', reason: 'stays' }, { path: 'b.md', destination: 'x/b.md', reason: 'links', linksBroken: true, moved: true }, { path: 'c.md', reason: 'both', linksBroken: true }], t)!;
    expect(message).toBe(`${t('folder.liveLeft', { paths: 'a.md, c.md' })} ${t('folder.liveLinksBroken', { paths: 'b.md, c.md' })}`);
    expect(message).toContain('b.md, c.md');
  });
});
