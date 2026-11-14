import { localizeR2References, r2AssetUrl, r2ReferenceKeys } from '@mygitnotes/core/r2-references';

interface ZipFile {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP of `files`, stored without compression (images, PDFs and video are compressed already). Names are UTF-8.
 * It has no ZIP64 records, so the whole archive stays under 4 GiB and 65 535 entries; `noteArchive` keeps well below.
 */
export function zipStore(files: ZipFile[], date = new Date()): Uint8Array<ArrayBuffer> {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(date.getFullYear(), 1980) - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  const entries = files.map(file => ({ name: new TextEncoder().encode(file.name), data: file.data, crc: crc32(file.data) }));
  const size = entries.reduce((sum, entry) => sum + 30 + 46 + 2 * entry.name.length + entry.data.length, 22);
  if (size > 0xffffffff || entries.length > 0xffff) throw new Error('The archive is too large for a ZIP file.');
  const zip = new Uint8Array(size), view = new DataView(zip.buffer);
  /** The fields a local header and a central directory record share: version, flags (UTF-8 names), stored, time, CRC and sizes. */
  const common = (at: number, entry: (typeof entries)[number]) => {
    view.setUint16(at, 20, true);
    view.setUint16(at + 2, 0x0800, true);
    view.setUint16(at + 4, 0, true);
    view.setUint16(at + 6, dosTime, true);
    view.setUint16(at + 8, dosDate, true);
    view.setUint32(at + 10, entry.crc, true);
    view.setUint32(at + 14, entry.data.length, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint16(at + 22, entry.name.length, true);
  };
  let offset = 0;
  const locals = entries.map(entry => {
    const local = offset;
    view.setUint32(offset, 0x04034b50, true);
    common(offset + 4, entry);
    zip.set(entry.name, offset + 30);
    zip.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
    return local;
  });
  const directory = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    common(offset + 6, entry);
    view.setUint32(offset + 42, locals[index], true);
    zip.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - directory, true);
  view.setUint32(offset + 16, directory, true);
  return zip;
}

/** What one archive holds at most: it is built in memory, in the browser. */
const ARCHIVE_BYTES = 1024 ** 3;

export interface NoteArchive {
  /** The archive's file name: the note's, ending in `.zip`. */
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** The keys whose objects are in the archive. */
  included: string[];
  /** The referenced keys left out, and why; the archive lists them in `missing-assets.txt`. */
  missing: { key: string; reason: string; }[];
}

/** A key whose segments are plain file names on every system an archive is opened on: no backslash, colon or control character. */
const archivable = (key: string) => ![...key].some(char => char === '\\' || char === ':' || char.charCodeAt(0) < 32);

/**
 * "Download with images": a ZIP of the note and the private R2 objects it references. Each object is fetched
 * through `/r2-assets/<key>?note=<path>`, so the server applies its usual check (the reader may read the note and
 * the note references the key). In the archive the note's references point at the files beside it, under `assets/`;
 * a reference whose object could not be fetched stays an `r2:` reference and is listed in `missing-assets.txt`.
 */
export async function noteArchive(note: { path: string; content: string; }, fetcher: typeof fetch = fetch, { maxBytes = ARCHIVE_BYTES }: { maxBytes?: number; } = {}): Promise<NoteArchive> {
  const name = note.path.split('/').pop() || 'note.md';
  const files: ZipFile[] = [], missing: NoteArchive['missing'] = [];
  const tooLarge = `the archive is limited to ${maxBytes} bytes`;
  let total = 0;
  for (const key of r2ReferenceKeys(note.content)) {
    if (!archivable(key)) {
      missing.push({ key, reason: 'the key cannot be a file name in an archive' });
      continue;
    }
    try {
      const response = await fetcher(r2AssetUrl(key, note.path), { credentials: 'same-origin' });
      if (!response.ok) {
        missing.push({ key, reason: `status ${response.status}` });
        continue;
      }
      // A declared size past the limit is refused before the body is read into memory.
      if (total + Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        missing.push({ key, reason: tooLarge });
        continue;
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (total + data.length > maxBytes) {
        missing.push({ key, reason: tooLarge });
        continue;
      }
      total += data.length;
      files.push({ name: `assets/${key}`, data });
    } catch (error) {
      missing.push({ key, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const included = files.map(file => file.name.slice('assets/'.length));
  const text = new TextEncoder();
  const markdown = localizeR2References(note.content, Object.fromEntries(included.map(key => [key, `assets/${key}`])));
  const listing = missing.length ? [{ name: 'missing-assets.txt', data: text.encode(missing.map(({ key, reason }) => `r2:${key}\t${reason}\n`).join('')) }] : [];
  return { filename: `${name.replace(/\.(md|markdown|mdx|txt)$/i, '')}.zip`, bytes: zipStore([{ name, data: text.encode(markdown) }, ...files, ...listing]), included, missing };
}
