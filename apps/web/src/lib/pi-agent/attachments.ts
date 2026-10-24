/** An image in the shape Pi's RPC `prompt`, `steer` and `follow_up` commands take in `images`. */
export interface PiImage {
  type: 'image';
  /** Base64, without a `data:` prefix. */
  data: string;
  mimeType: string;
}

/** An image waiting in the message box: what Pi gets, plus what the thumbnail and its remove button need. */
export interface ImageAttachment {
  id: string;
  name: string;
  /** The file's size in bytes, before base64. */
  size: number;
  image: PiImage;
}

/** The formats Pi reads as they are; it converts others itself, but a browser cannot always preview those. */
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/**
 * Together the images stay under 10 MiB, which is 13.4 MiB as base64: under the 16 MiB a WebSocket frame may carry
 * to the server and the bridge, with room for the text.
 */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;

export type AttachmentProblem =
  | { kind: 'type'; name: string; }
  | { kind: 'size'; name: string; }
  | { kind: 'total'; name: string; }
  | { kind: 'count'; name: string; }
  | { kind: 'read'; name: string; };

function readBase64(file: File): Promise<string> {
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

/**
 * Turns the files a person added into attachments, after the ones already waiting. A file over a limit or of another type
 * is left out and named in `problems`, so the message box can say why; the rest still go in.
 */
export async function addImageFiles(existing: readonly ImageAttachment[], files: readonly File[]): Promise<{ attachments: ImageAttachment[]; problems: AttachmentProblem[]; }> {
  const attachments = [...existing];
  const problems: AttachmentProblem[] = [];
  let total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  for (const file of files) {
    const name = file.name || 'image';
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) problems.push({ kind: 'type', name });
    else if (attachments.length >= MAX_ATTACHMENTS) problems.push({ kind: 'count', name });
    else if (file.size > MAX_ATTACHMENT_BYTES) problems.push({ kind: 'size', name });
    else if (total + file.size > MAX_ATTACHMENTS_BYTES) problems.push({ kind: 'total', name });
    else {
      try {
        attachments.push({ id: crypto.randomUUID(), name, size: file.size, image: { type: 'image', data: await readBase64(file), mimeType: file.type } });
        total += file.size;
      } catch {
        problems.push({ kind: 'read', name });
      }
    }
  }
  return { attachments, problems };
}

export const thumbnailUrl = (image: PiImage) => `data:${image.mimeType};base64,${image.data}`;
