import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// These props supply the heading/content of a component or feed its T1 trigger, not a native DOM title.
const contentProps = new Set(['BookFolder', 'DiffPreview', 'FilterPopover', 'FocusNameDialog', 'FolderActions', 'FolderPickerDialog', 'InlineNoteSlot', 'LiveBadge', 'LiveCollabEditor', 'LiveEditorFrame', 'NavTreeRow', 'NoteActionsMenu', 'NoteExportItems', 'NoteExportMenu', 'NoteSelectBox', 'NoteTitleEdit', 'PhoneBackBar', 'PhoneNoteSheet', 'PhoneSheet', 'RenameNoteDialog', 'RenameRow', 'SidebarLinkAnchor', 'SlideDeck', 'WorkspaceDialog', 'YouTubeChapter']);

function* files(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) yield file;
  }
}

type AstNode = { type?: string; start?: number; end?: number; name?: AstNode | string; attributes?: AstNode[]; };
function inspect(node: unknown, visit: (node: AstNode) => void) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of Object.values(node)) inspect(child, visit);
}

it('uses T1 instead of native hover titles', () => {
  const violations: string[] = [];
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    const report = (offset: number, tag: string) => violations.push(`${relative(root, file)}:${source.slice(0, offset).split('\n').length}: ${tag}`);
    inspect(parseSync(file, source).program, node => {
      if (node.type !== 'JSXOpeningElement' || !node.attributes?.some(attr => attr.type === 'JSXAttribute' && typeof attr.name === 'object' && attr.name.name === 'title')) return;
      const tag = typeof node.name === 'object' ? source.slice(node.name.start, node.name.end) : '';
      if (tag !== 'iframe' && !contentProps.has(tag)) report(node.start ?? 0, tag);
    });
    // Rendered HTML must carry data-t1-label. Embedded image descriptions are authored content.
    for (const match of source.matchAll(/<(?:button|a|span|abbr|img|input|select)\b[^<>\n]*?\s+title\s*=/g)) {
      if (file.endsWith('.tsx') || relative(root, file) === 'lib/annotations/render.ts' && match[0].startsWith('<img ')) continue;
      report(match.index, 'HTML title');
    }
  }
  expect(violations).toEqual([]);
});
