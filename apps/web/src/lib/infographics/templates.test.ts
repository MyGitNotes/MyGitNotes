import { describe, expect, it } from 'vitest';
import { en, type TranslationKey } from '../i18n/en.js';
import { zhTW } from '../i18n/zh-TW.js';
import { checkCells, INFOGRAPHIC_KINDS, parseInfographic } from './model.js';
import { INFOGRAPHIC_MENU, infographicTemplate } from './templates.js';

const translator = (dictionary: Record<TranslationKey, string>) => (key: TranslationKey) => dictionary[key];

describe('infographic templates', () => {
  it('lists the seven kinds in the insert menu', () => {
    expect([...INFOGRAPHIC_MENU]).toEqual([...INFOGRAPHIC_KINDS]);
  });

  for (const [language, dictionary] of [['English', en], ['Traditional Chinese', zhTW]] as const) {
    it(`gives a working ${language} example of every kind: the right kind, nothing the grid cannot hold, no bad cell`, () => {
      for (const kind of INFOGRAPHIC_KINDS) {
        const source = infographicTemplate(kind, translator(dictionary));
        const block = parseInfographic(source);
        expect(block?.kind, kind).toBe(kind);
        expect(block?.problems, kind).toEqual([]);
        expect(checkCells(block!), kind).toEqual([]);
        expect(block!.rows.length + block!.children.flatMap(child => child.rows).length, kind).toBeGreaterThan(0);
        expect(source.endsWith('\n'), kind).toBe(true);
      }
    });
  }

  it('gives every kind a name and a one-line purpose in both languages', () => {
    for (const kind of INFOGRAPHIC_KINDS) {
      for (const dictionary of [en, zhTW]) {
        expect(dictionary[`infographic.kind.${kind}` as TranslationKey]).toBeTruthy();
        expect(dictionary[`infographic.kind.${kind}.purpose` as TranslationKey]).not.toContain('\n');
      }
    }
  });
});
