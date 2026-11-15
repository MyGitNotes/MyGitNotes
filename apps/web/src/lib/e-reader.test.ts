import { describe, expect, it } from 'vitest';
import { detectEReader, isEReaderModel } from './e-reader.js';

describe('isEReaderModel', () => {
  it('takes BOOX model names as an e-reader', () => {
    for (const model of ['Page', 'page', 'Leaf2', 'Leaf3C', 'Palma', 'Palma2', 'Go103', 'Go Color 7', 'Poke5', 'Poke5P', 'NoteAir3C', 'Note Air2 Plus', 'NoteX3', 'Note5', 'Tab Ultra C Pro', 'TabMiniC', 'Tab Mini C', 'Nova3 Color', 'Nova Air C', 'Max Lumi', 'MaxLumi2', 'Max3', 'Lumi', ' Page ']) {
      expect(isEReaderModel(model), model).toBe(true);
    }
  });

  it('takes no phone, tablet or empty model as one', () => {
    for (const model of ['', '  ', 'Pixel 8', 'Pixel 7 Pro', 'SM-S918B', 'SM-N986B', 'SM-X710', 'iPad', 'iPad13,1', 'Google Pixel Tablet', 'Redmi Note 12', 'Pager', 'Pages', 'Gold', 'Novak', 'Lumia 950', 'K']) {
      expect(isEReaderModel(model), model).toBe(false);
    }
  });
});

describe('detectEReader', () => {
  const browser = (model: string | Error) =>
    ({
      userAgentData: {
        getHighEntropyValues: async (hints: string[]) => {
          expect(hints).toEqual(['model']);
          if (model instanceof Error) throw model;
          return { model };
        },
      },
    }) as unknown as Navigator;

  it('reads the model hint where the browser offers it', async () => {
    await expect(detectEReader(browser('Page'))).resolves.toBe(true);
    await expect(detectEReader(browser('Pixel 8'))).resolves.toBe(false);
  });

  it('is false without the model hint, without a navigator, or when the hint is refused', async () => {
    await expect(detectEReader({} as Navigator)).resolves.toBe(false);
    await expect(detectEReader({ userAgentData: {} } as unknown as Navigator)).resolves.toBe(false);
    await expect(detectEReader(undefined)).resolves.toBe(false);
    await expect(detectEReader(browser(new Error('NotAllowedError')))).resolves.toBe(false);
  });
});
