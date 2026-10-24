// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { addImageFiles, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, thumbnailUrl } from './attachments.js';

const file = (name: string, type: string, bytes: number | string = 4) => new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type });

it("reads an image into the shape of Pi's RPC `images` as base64 without a data: prefix", async () => {
  const { attachments, problems } = await addImageFiles([], [file('shot.png', 'image/png', 'abc')]);
  expect(problems).toEqual([]);
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({ name: 'shot.png', size: 3, image: { type: 'image', data: 'YWJj', mimeType: 'image/png' } });
  expect(thumbnailUrl(attachments[0].image)).toBe('data:image/png;base64,YWJj');
});

it('takes PNG, JPEG, GIF and WebP, and names each file of another type as refused while keeping the rest', async () => {
  const { attachments, problems } = await addImageFiles([], [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.gif', 'image/gif'), file('d.webp', 'image/webp'), file('notes.pdf', 'application/pdf'), file('e.svg', 'image/svg+xml'), file('', '')]);
  expect(attachments.map(attachment => attachment.image.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  expect(problems).toEqual([{ kind: 'type', name: 'notes.pdf' }, { kind: 'type', name: 'e.svg' }, { kind: 'type', name: 'image' }]);
});

it('refuses an image over the per-image size, and one that would pass the total, naming why', async () => {
  const big = file('big.png', 'image/png', MAX_ATTACHMENT_BYTES + 1);
  const exact = file('exact.png', 'image/png', MAX_ATTACHMENT_BYTES);
  const first = await addImageFiles([], [big, exact]);
  expect(first.attachments.map(attachment => attachment.name)).toEqual(['exact.png']);
  expect(first.problems).toEqual([{ kind: 'size', name: 'big.png' }]);
  const second = await addImageFiles(first.attachments, [file('b.png', 'image/png', MAX_ATTACHMENT_BYTES), file('c.png', 'image/png', 1)]);
  expect(second.attachments.map(attachment => attachment.name)).toEqual(['exact.png', 'b.png']);
  expect(second.problems).toEqual([{ kind: 'total', name: 'c.png' }]);
  expect(MAX_ATTACHMENTS_BYTES).toBe(2 * MAX_ATTACHMENT_BYTES);
});

it('takes at most the count limit across additions', async () => {
  const names = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, index) => `${index}.png`);
  const first = await addImageFiles([], names.slice(0, 3).map(name => file(name, 'image/png')));
  const second = await addImageFiles(first.attachments, names.slice(3).map(name => file(name, 'image/png')));
  expect(second.attachments).toHaveLength(MAX_ATTACHMENTS);
  expect(second.problems).toEqual([{ kind: 'count', name: names[5] }, { kind: 'count', name: names[6] }]);
});
