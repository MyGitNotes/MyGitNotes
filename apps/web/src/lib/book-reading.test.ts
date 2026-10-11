import { expect, it } from 'vitest';
import { BOOK_READING_STORAGE_KEY, readBookReadingMode, writeBookReadingMode } from './book-reading.js';

const storage = (initial?: string) => {
  const values = new Map<string, string>(initial === undefined ? [] : [[BOOK_READING_STORAGE_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
};

it('reads continuously unless this device chose paging', () => {
  expect(readBookReadingMode(storage())).toBe('continuous');
  expect(readBookReadingMode(storage('paged'))).toBe('paged');
  expect(readBookReadingMode(storage('something else'))).toBe('continuous');
  expect(readBookReadingMode({
    getItem: () => {
      throw new Error('blocked');
    },
  })).toBe('continuous');
});

it('writes the choice to the given storage only, under the one key', () => {
  const target = storage();
  writeBookReadingMode('paged', target);
  expect([...target.values]).toEqual([[BOOK_READING_STORAGE_KEY, 'paged']]);
  writeBookReadingMode('continuous', {
    setItem: () => {
      throw new Error('full');
    },
  });
});
