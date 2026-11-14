import path from 'node:path';

/** What a viewer can do with a file, told by its extension or well-known name. */
export type FileKind = 'text' | 'pdf' | 'html' | 'image' | 'audio' | 'video' | 'other';

const TEXT_EXTENSIONS = new Set([
  // Notes and prose
  'md',
  'markdown',
  'mdx',
  'txt',
  'rst',
  'adoc',
  'org',
  'tex',
  'bib',
  'srt',
  'vtt',
  // Data and configuration
  'sql',
  'yml',
  'yaml',
  'json',
  'jsonc',
  'json5',
  'jsonl',
  'ndjson',
  'csv',
  'tsv',
  'xml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'env',
  'log',
  'lock',
  'tf',
  'tfvars',
  'hcl',
  'proto',
  'graphql',
  'gql',
  'diff',
  'patch',
  // Source code
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'scala',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'pl',
  'lua',
  'r',
  'jl',
  'dart',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'gradle',
  'cmake',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'astro',
  'typ',
]);
const TEXT_NAMES = new Set(['makefile', 'dockerfile', 'license', 'licence', 'readme', 'changelog', 'authors', 'contributors', 'notice', 'procfile', 'gemfile', 'rakefile', 'brewfile', 'justfile', 'codeowners']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml']);

export function fileKind(file: string): FileKind {
  const name = path.posix.basename(file).toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (!extension) return TEXT_NAMES.has(name) ? 'text' : 'other';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (extension === 'pdf') return 'pdf';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'other';
}

/** Whether a viewer can show the file as plain text. */
export const isTextFile = (file: string) => fileKind(file) === 'text';

const SANDBOXED = "default-src 'none'; sandbox";

/**
 * How the raw file route sends a file. A text file goes out as plain text, never under the type its extension names (a
 * `.ts` file is video to a type table, a `.sql` file a download). A PDF goes out as a PDF under a policy without `sandbox`,
 * which the browser's PDF viewer refuses; the bytes are only ever read as a PDF. HTML and every other file keep the sandbox
 * and the type their extension names, so a page runs no script and shares no origin with the app.
 */
export function rawFileHeaders(file: string): { contentType?: string; contentSecurityPolicy: string; } {
  const kind = fileKind(file);
  if (kind === 'text') return { contentType: 'text/plain; charset=utf-8', contentSecurityPolicy: SANDBOXED };
  if (kind === 'pdf') return { contentType: 'application/pdf', contentSecurityPolicy: "default-src 'none'" };
  if (kind === 'html') return { contentType: 'text/html; charset=utf-8', contentSecurityPolicy: SANDBOXED };
  return { contentSecurityPolicy: SANDBOXED };
}
