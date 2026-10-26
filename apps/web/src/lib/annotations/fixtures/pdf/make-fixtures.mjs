// Writes the PDF fixtures next to this file: node make-fixtures.mjs
// multi-page.pdf  four pages: Letter portrait, A4 landscape, a portrait page stored with /Rotate 90, and a page of Traditional Chinese
//                 text in a font that is not embedded (MSungStd-Light, Adobe-CNS1)
// encrypted.pdf   the same document, RC4 40-bit, opened only by the user password "secret"
// truncated.pdf   multi-page.pdf cut in half
// not-a-pdf.pdf   a PNG with a .pdf name
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = dirname(fileURLToPath(import.meta.url));
const md5 = bytes => createHash('md5').update(bytes).digest();
const latin = text => Buffer.from(text, 'latin1');

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const result = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    result[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return result;
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const pad = password => Buffer.concat([latin(password), PAD]).subarray(0, 32);
const hex = bytes => `<${Buffer.from(bytes).toString('hex')}>`;

/** The pages as `{ width, height, rotate?, content, fonts }`; returns the objects of a document, numbered from 1. */
function documentObjects() {
  const pages = [
    { width: 612, height: 792, content: 'BT /F1 28 Tf 72 700 Td (Page one) Tj ET 72 560 300 60 re S BT /F1 12 Tf 72 530 Td (Letter portrait, 612 x 792) Tj ET' },
    { width: 842, height: 595, content: 'BT /F1 28 Tf 72 500 Td (Page two) Tj ET 400 200 300 120 re S BT /F1 12 Tf 72 470 Td (A4 landscape, 842 x 595) Tj ET' },
    { width: 400, height: 600, rotate: 90, content: 'BT /F1 28 Tf 40 520 Td (Page three) Tj ET 40 300 200 100 re S BT /F1 12 Tf 40 490 Td (Stored 400 x 600 with Rotate 90) Tj ET' },
    { width: 612, height: 792, content: `BT /F2 26 Tf 72 700 Td <${big5('合約草稿')}> Tj ET BT /F2 14 Tf 72 660 Td <${big5('甲方名稱與統編要和用印頁一致')}> Tj ET 72 540 320 80 re S` },
  ];
  const objects = [];
  const add = body => objects.push(body) && objects.length;
  const catalog = add('');
  const tree = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const descendant = add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MSungStd-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (CNS1) /Supplement 0 >> /DW 1000 >>');
  const f2 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /MSungStd-Light /Encoding /ETen-B5-H /DescendantFonts [${descendant} 0 R] >>`);
  const kids = [];
  for (const page of pages) {
    const stream = add({ stream: latin(page.content) });
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${page.width} ${page.height}] ${page.rotate ? `/Rotate ${page.rotate} ` : ''}/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map(kid => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  return { objects, root: catalog };
}

/** The Big5 bytes of a string, hex-encoded, found by decoding every double-byte code (Node decodes Big5 but does not encode it). */
const big5Codes = new Map();
function big5(text) {
  if (!big5Codes.size) {
    const decoder = new TextDecoder('big5', { fatal: true });
    for (let lead = 0xa1; lead <= 0xf9; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        try {
          const char = decoder.decode(Uint8Array.of(lead, trail));
          if (char.length === 1 && !big5Codes.has(char)) big5Codes.set(char, lead.toString(16) + trail.toString(16).padStart(2, '0'));
        } catch {
          // not a Big5 code
        }
      }
    }
  }
  return [...text].map(char => big5Codes.get(char) ?? (char === ' ' ? '20' : (() => { throw new Error(`no Big5 code for ${char}`); })())).join('');
}

function serialise({ objects, root }, encryption) {
  const id = md5(latin('mygitnotes-fixture'));
  const chunks = [latin('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  const offsets = [];
  let length = chunks[0].length;
  const push = chunk => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const encryptObject = (data, number) => {
    if (!encryption) return data;
    const key = md5(Buffer.concat([encryption.key, Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0])])).subarray(0, 10);
    return rc4(key, data);
  };
  const allObjects = [...objects];
  let encryptNumber = 0;
  if (encryption) {
    allObjects.push(`<< /Filter /Standard /V 1 /R 2 /O ${hex(encryption.o)} /U ${hex(encryption.u)} /P ${encryption.p} >>`);
    encryptNumber = allObjects.length;
  }
  allObjects.forEach((body, index) => {
    const number = index + 1;
    offsets.push(length);
    if (typeof body === 'string') {
      push(latin(`${number} 0 obj\n${body}\nendobj\n`));
    } else {
      const data = encryptObject(body.stream, number);
      push(Buffer.concat([latin(`${number} 0 obj\n<< /Length ${data.length} >>\nstream\n`), data, latin('\nendstream\nendobj\n')]));
    }
  });
  const xref = length;
  push(latin(`xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`));
  push(latin(`trailer\n<< /Size ${allObjects.length + 1} /Root ${root} 0 R ${encryption ? `/Encrypt ${encryptNumber} 0 R ` : ''}/ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

function encryptionFor(userPassword, ownerPassword) {
  const p = -4;
  const id = md5(latin('mygitnotes-fixture'));
  const o = rc4(md5(pad(ownerPassword)).subarray(0, 5), pad(userPassword));
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p);
  const key = md5(Buffer.concat([pad(userPassword), o, pBytes, id])).subarray(0, 5);
  return { o, u: rc4(key, PAD), p, key };
}

const plain = serialise(documentObjects());
writeFileSync(join(out, 'multi-page.pdf'), plain);
writeFileSync(join(out, 'encrypted.pdf'), serialise(documentObjects(), encryptionFor('secret', 'owner')));
writeFileSync(join(out, 'truncated.pdf'), plain.subarray(0, Math.floor(plain.length / 2)));
writeFileSync(join(out, 'not-a-pdf.pdf'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHg3XWAAAAABJRU5ErkJggg==', 'base64'));
