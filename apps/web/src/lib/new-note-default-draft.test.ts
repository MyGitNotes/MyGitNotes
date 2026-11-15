import { LIVE_DEFAULT_DRAFT_LINES } from '@mygitnotes/core/live-default-draft';
import { describe, expect, it } from 'vitest';
import type { Language } from './i18n/context.js';
import { en, type TranslationKey } from './i18n/en.js';
import { zhTW } from './i18n/zh-TW.js';
import { buildNewNoteDraft } from './new-note.js';

/*
 * Core takes the web's untouched new note out of a pending live draft before judging it empty (isEmptyLiveDraft): a
 * translation changed here without core's list would file placeholder notes on the nightly sweep.
 */
// Typed by every Language the web ships, so a new locale cannot be left out here.
const shipped: Record<Language, Record<TranslationKey, string>> = { en, 'zh-TW': zhTW };

describe('the untemplated new note core takes as an empty live draft', () => {
  for (const [locale, messages] of Object.entries(shipped)) {
    it(`lists ${locale}'s heading and body`, () => {
      const title = messages['createNote.untitled'];
      const body = messages['createNote.body'];
      expect(LIVE_DEFAULT_DRAFT_LINES).toContain(`# ${title}`);
      expect(LIVE_DEFAULT_DRAFT_LINES).toContain(body);
      const { content } = buildNewNoteDraft({ slug: 'untitled', title, tags: [], status: 'inbox', body });
      const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
      for (const line of lines) expect(LIVE_DEFAULT_DRAFT_LINES, line).toContain(line);
    });
  }
});
