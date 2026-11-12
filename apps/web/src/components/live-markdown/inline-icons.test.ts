// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { InlineIconWidget } from './inline-icons.js';
import { loadLucideIcons } from '../../lib/icons/lucide-registry.js';

const t = (key: string) => key;
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const views: EditorView[] = [];
function editor(doc: string, cursor = doc.length) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, decorations] }) });
  views.push(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}
beforeAll(async () => {
  await loadLucideIcons();
});
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The icons the live editor draws, with the source each one replaces. */
function icons(view: EditorView) {
  const found: { name: string; size?: string; source: string; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, to, value: Decoration) => {
    if (value.spec.widget instanceof InlineIconWidget) found.push({ name: value.spec.widget.name, size: value.spec.widget.size, source: view.state.sliceDoc(from, to) });
  });
  return found;
}

const note = ':icon{name="User"} 評論人　洪偉｜:icon{name="FileText" size="20"} 頁碼依 11/12 補署名版\n\nPlain `:icon{name="Code"}` and\n\n```\n:icon{name="Fence"}\n```\n\nend';

describe('inline icons in the live editor', () => {
  it('draws each directive as its Lucide icon, in place of its source', () => {
    const view = editor(note, note.length);
    expect(icons(view)).toEqual([{ name: 'User', size: undefined, source: ':icon{name="User"}' }, { name: 'FileText', size: '20', source: ':icon{name="FileText" size="20"}' }]);
    const drawn = [...view.dom.querySelectorAll<HTMLElement>('.live-md-icon')];
    expect(drawn).toHaveLength(2);
    expect(drawn[0].querySelector('circle')!.getAttribute('r')).toBe('4');
    expect(drawn[1].querySelector('svg')!.getAttribute('width')).toBe('20');
    expect(view.dom.textContent).toContain('評論人　洪偉｜');
    expect(view.dom.textContent).not.toContain(':icon{name="User"}');
  });

  it('leaves code alone', () => {
    const view = editor(note);
    expect(view.dom.textContent).toContain(':icon{name="Code"}');
    expect(view.dom.textContent).toContain(':icon{name="Fence"}');
  });

  it('shows the source of the directive the caret is in, and only that one', () => {
    const inside = note.indexOf('name="User"') + 3;
    const view = editor(note, inside);
    expect(icons(view).map(icon => icon.name)).toEqual(['FileText']);
    expect(view.dom.textContent).toContain(':icon{name="User"}');
  });

  it('keeps an icon drawn while the caret sits right beside it', () => {
    const end = note.indexOf('} 評論人') + 1;
    expect(icons(editor(note, end)).map(icon => icon.name)).toEqual(['User', 'FileText']);
    expect(icons(editor(note, 0)).map(icon => icon.name)).toEqual(['User', 'FileText']);
  });

  it('brings the source back when the icon is clicked', () => {
    const view = editor(note);
    view.dom.querySelector('.live-md-icon')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const { anchor } = view.state.selection.main;
    expect(anchor).toBeGreaterThan(0);
    expect(anchor).toBeLessThan(':icon{name="User"}'.length);
    expect(icons(view).map(icon => icon.name)).toEqual(['FileText']);
  });
});
