import { openPdfBytes, type PdfDocument, PdfLoadError } from '../pdf/pdf-document.js';
import type { AttachedFile } from './transcript.js';

/** An image in the shape Pi's RPC `prompt`, `steer` and `follow_up` commands take in `images`. */
export interface PiImage {
  type: 'image';
  /** Base64, without a `data:` prefix. */
  data: string;
  mimeType: string;
}

/** An image waiting in the message box: what Pi gets, plus what the thumbnail and its remove button need. */
export interface ImageAttachment {
  kind: 'image';
  id: string;
  name: string;
  /** The file's size in bytes, before base64. */
  size: number;
  image: PiImage;
}

/**
 * A text, code or PDF file waiting in the message box: the text that goes into the message, and the pictures of the PDF
 * pages that have no text (a scan), which go with the message's images.
 */
export interface FileAttachment {
  kind: 'file';
  id: string;
  name: string;
  size: number;
  file: AttachedFile;
  images: PiImage[];
}

export type Attachment = ImageAttachment | FileAttachment;

/** The formats Pi reads as they are; it converts others itself, but a browser cannot always preview those. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Files read as UTF-8 text by name, since a browser gives many of them no type or a wrong one (`.ts` as a video). */
export const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'r', 'lua', 'tex', 'bib', 'log', 'ini', 'cfg', 'conf', 'diff', 'patch', 'srt', 'vtt', 'rst', 'adoc', 'org'] as const;
/** What the file picker offers: every format {@link addFiles} takes, images only while the model reads them. */
export const acceptedTypes = (images: boolean) => [...images ? IMAGE_TYPES : [], 'application/pdf', '.pdf', 'text/*', ...TEXT_EXTENSIONS.map(extension => `.${extension}`)].join(',');

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/**
 * Together the images stay under 10 MiB, which is 13.4 MiB as base64: under the 16 MiB a WebSocket frame may carry
 * to the server and the bridge, with room for the text.
 */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
/** A PDF is read in the browser and only its text and page pictures are sent, so the file itself may be larger. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
/**
 * The characters the files of one message add up to: about 0.8 MB as UTF-8 at most, which keeps the frame under its
 * limit beside the images, and a share of a model's context a person can still see coming.
 */
export const MAX_ATTACHED_TEXT = 200_000;
/** The longest side of a PDF page drawn as a picture, in pixels; vision models scale larger images down to about this. */
export const PAGE_IMAGE_EDGE = 1568;

/** The largest WebSocket frame the server accepts is 16 MiB; a prompt is refused before it is sent past this. */
export const MAX_FRAME_BYTES = 15.5 * 1024 * 1024;

/** The bytes a serialized frame takes on the wire. */
export const frameBytes = (frame: string) => new TextEncoder().encode(frame).length;

/** The bytes an image's base64 decodes to, its `=` padding left out. */
export const imageBytes = (image: PiImage) => Math.floor(image.data.length * 3 / 4) - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);

/** Whether images together stay inside the count and size limits a single message is held to, measured from their base64. */
export function imagesWithinLimits(images: readonly PiImage[]): boolean {
  if (images.length > MAX_ATTACHMENTS) return false;
  const sizes = images.map(imageBytes);
  return sizes.every(size => size <= MAX_ATTACHMENT_BYTES) && sizes.reduce((sum, size) => sum + size, 0) <= MAX_ATTACHMENTS_BYTES;
}

/** Every image the attachments send: each image, and the page pictures of each PDF, in order. */
export const attachmentImages = (attachments: readonly Attachment[]) => attachments.flatMap(attachment => attachment.kind === 'image' ? [attachment.image] : attachment.images);
/** The files the attachments put into the message as text, in order. */
export const attachmentFiles = (attachments: readonly Attachment[]) => attachments.flatMap(attachment => attachment.kind === 'file' ? [attachment.file] : []);

/**
 * Why a file was left out or went in only in part. `limit` names the size a `size` refusal passed; `truncated` keeps the
 * file's start, `pages` keeps a PDF whose pages without text found no room as pictures, and `imageModel` refuses an
 * image for a model that cannot read one.
 */
export type AttachmentProblem = { kind: 'size'; name: string; limit: string; } | { kind: 'model' | 'imageModel' | 'command' | 'type' | 'total' | 'count' | 'read' | 'password' | 'empty' | 'textTotal' | 'truncated' | 'pages'; name: string; };

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Draws a PDF page into a JPEG no larger than {@link PAGE_IMAGE_EDGE} on its longest side. */
export async function renderPageImage(pdf: PdfDocument, page: number): Promise<PiImage> {
  const { width, height } = await pdf.pageSize(page);
  const canvas = document.createElement('canvas');
  await pdf.render(page, canvas, { cssWidth: PAGE_IMAGE_EDGE * width / Math.max(width, height), pixelRatio: 1 }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('The page could not be drawn.')), 'image/jpeg', 0.85));
  return { type: 'image', data: await readBase64(blob), mimeType: 'image/jpeg' };
}

export interface AddFilesOptions {
  /** Whether the model reads images: an image is refused without it, and a PDF page without text is then not drawn. */
  images: boolean;
  openPdf?: (bytes: Uint8Array) => Promise<PdfDocument>;
  renderPage?: (pdf: PdfDocument, page: number) => Promise<PiImage>;
}

const extensionOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
const isPdf = (file: File) => file.type === 'application/pdf' || extensionOf(file.name) === 'pdf';
const isText = (file: File) => (TEXT_EXTENSIONS as readonly string[]).includes(extensionOf(file.name)) || file.type.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(file.type);
const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`;

type Read = { text: string; images: PiImage[]; problems: AttachmentProblem[]; } | { problem: AttachmentProblem; };

/** The UTF-8 text of a file, refused as another type when it is not UTF-8 or holds a NUL, as binary files do. */
async function readText(file: File, name: string): Promise<Read> {
  if (file.size > MAX_TEXT_FILE_BYTES) return { problem: { kind: 'size', name, limit: megabytes(MAX_TEXT_FILE_BYTES) } };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    return { problem: { kind: error instanceof TypeError ? 'type' : 'read', name } };
  }
  if (text.includes('\0')) return { problem: { kind: 'type', name } };
  return { text: text.replace(/^\uFEFF/, ''), images: [], problems: [] };
}

/**
 * The text of every page of a PDF, each under a `[page N]` line, until it holds `room.text` characters (the rest would
 * be cut). A page without text is drawn as a picture while the model reads images and `room` has space for one;
 * otherwise, and after one picture found no room, its line says it was left out.
 */
async function readPdf(file: File, name: string, options: AddFilesOptions, room: { count: number; bytes: number; text: number; }): Promise<Read> {
  if (file.size > MAX_PDF_BYTES) return { problem: { kind: 'size', name, limit: megabytes(MAX_PDF_BYTES) } };
  let pdf: PdfDocument;
  try {
    pdf = await (options.openPdf ?? openPdfBytes)(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return { problem: { kind: error instanceof PdfLoadError && error.code === 'password' ? 'password' : 'read', name } };
  }
  const parts: string[] = [], images: PiImage[] = [];
  let missing = 0, textPages = 0, length = 0, drawing = options.images;
  try {
    for (let page = 1; page <= pdf.pageCount && length <= room.text; page++) {
      const text = (await pdf.text(page)).trim();
      if (text) {
        textPages++;
        parts.push(`[page ${page}]\n${text}`);
      } else {
        const image = drawing && room.count > images.length ? await (options.renderPage ?? renderPageImage)(pdf, page).catch(() => undefined) : undefined;
        if (image && imageBytes(image) <= MAX_ATTACHMENT_BYTES && imageBytes(image) <= room.bytes) {
          images.push(image);
          room.bytes -= imageBytes(image);
          parts.push(`[page ${page}: no text layer; its picture is attached as an image]`);
        } else {
          // Once one page finds no room, later ones would not either, so none is drawn just to be dropped.
          drawing = false;
          missing++;
          parts.push(`[page ${page}: no text layer; not attached]`);
        }
      }
      length += parts.at(-1)!.length + 2;
    }
  } catch {
    return { problem: { kind: 'read', name } };
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
  if (!textPages && !images.length) return { problem: { kind: 'empty', name } };
  return { text: `[PDF, ${pdf.pageCount} pages]\n\n${parts.join('\n\n')}`, images, problems: missing ? [{ kind: 'pages', name }] : [] };
}

/**
 * Turns the files a person added into attachments, after the ones already waiting: images as they are, PDFs and text
 * or code files as text (see {@link readPdf}). A file over a limit or of another type is left out and named in
 * `problems`, so the message box can say why; the rest still go in. The files of a message share
 * {@link MAX_ATTACHED_TEXT}, and one that passes it goes in cut to fit, with a line saying so.
 */
export async function addFiles(existing: readonly Attachment[], files: readonly File[], options: AddFilesOptions): Promise<{ attachments: Attachment[]; problems: AttachmentProblem[]; }> {
  const attachments = [...existing];
  const problems: AttachmentProblem[] = [];
  const images = () => attachmentImages(attachments);
  const imageTotal = () => images().reduce((sum, image) => sum + imageBytes(image), 0);
  const textTotal = () => attachmentFiles(attachments).reduce((sum, file) => sum + file.text.length, 0);
  for (const file of files) {
    const name = file.name || 'file';
    if ((IMAGE_TYPES as readonly string[]).includes(file.type)) {
      if (!options.images) problems.push({ kind: 'imageModel', name });
      else if (images().length >= MAX_ATTACHMENTS) problems.push({ kind: 'count', name });
      else if (file.size > MAX_ATTACHMENT_BYTES) problems.push({ kind: 'size', name, limit: megabytes(MAX_ATTACHMENT_BYTES) });
      else if (imageTotal() + file.size > MAX_ATTACHMENTS_BYTES) problems.push({ kind: 'total', name });
      else {
        try {
          attachments.push({ kind: 'image', id: crypto.randomUUID(), name, size: file.size, image: { type: 'image', data: await readBase64(file), mimeType: file.type } });
        } catch {
          problems.push({ kind: 'read', name });
        }
      }
      continue;
    }
    if (!isPdf(file) && !isText(file)) {
      problems.push({ kind: 'type', name });
      continue;
    }
    const room = MAX_ATTACHED_TEXT - textTotal();
    if (room <= 0) {
      problems.push({ kind: 'textTotal', name });
      continue;
    }
    const read = isPdf(file) ? await readPdf(file, name, options, { count: MAX_ATTACHMENTS - images().length, bytes: MAX_ATTACHMENTS_BYTES - imageTotal(), text: room }) : await readText(file, name);
    if ('problem' in read) {
      problems.push(read.problem);
      continue;
    }
    const cut = read.text.length > room;
    // A cut between the two halves of a surrogate pair would leave half a character.
    const kept = cut ? read.text.slice(0, /[\uD800-\uDBFF]/.test(read.text[room - 1]) ? room - 1 : room) : read.text;
    const text = cut ? `${kept}\n[cut: the rest of this file is not attached]` : read.text;
    attachments.push({ kind: 'file', id: crypto.randomUUID(), name, size: file.size, file: { name, text }, images: read.images });
    problems.push(...read.problems, ...cut ? [{ kind: 'truncated' as const, name }] : []);
  }
  return { attachments, problems };
}

export const thumbnailUrl = (image: PiImage) => `data:${image.mimeType};base64,${image.data}`;
