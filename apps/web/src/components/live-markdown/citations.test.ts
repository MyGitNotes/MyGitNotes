// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { Compartment, EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { atCompletionSource } from './at-completion-source.js';
import { citationCompletionSource } from './citation-completion-source.js';
import { CitationChip, citationLibrary, citationLibraryOf } from './citations.js';

const t = (key: string, params?: Record<string, string | number>) => params ? `${key} ${Object.values(params).join(' ')}` : key;
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const library = citationLibraryOf([{ key: 'sosa2007', authors: ['Sosa'], year: '2007', title: 'A Virtue Epistemology' }, { key: 'two2010', authors: ['Smith', 'Doe'], year: '2010', title: 'Two Authors' }, { key: 'today', authors: ['Zed'], year: '1999', title: 'Named like a task token' }]);
const inProject: Extension = citationLibrary.of(library);

const views: EditorView[] = [];
function editor(doc: string, cursor = doc.length, extra: Extension = inProject) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, extra, decorations] }) });
  views.push(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}
afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

/** The citations the live editor draws, with the source each one stands for. */
function chips(view: EditorView) {
  const found: { text: string; source: string; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, to, value: Decoration) => {
    if (value.spec.widget instanceof CitationChip) found.push({ text: value.spec.widget.text, source: view.state.sliceDoc(from, to) });
  });
  return found;
}
/** The source ranges marked as citing a key the bibliography lacks, with the title each shows. */
function missing(view: EditorView) {
  const found: { source: string; title: string; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, to, value: Decoration) => {
    if (value.spec.class === 'live-md-citation-missing') found.push({ source: view.state.sliceDoc(from, to), title: value.spec.attributes.title });
  });
  return found;
}

const note = '甲 [@sosa2007] 乙\n\n另見 [@sosa2007, 23]，@two2010 也說 [-@two2010]。\n\n沒有 [@missing] 與 [@sosa2007; @gone]，@nobody 不算。\n\n- [ ] 問 @two2010 與 @alice\n\n`[@sosa2007]` 與 [連結 @two2010](https://x)\n\nend';

describe('citations in the live editor', () => {
  it('draws a citation in place of its source when the caret is on another line', () => {
    const view = editor(note);
    expect(chips(view)).toEqual([{ text: '(Sosa 2007)', source: '[@sosa2007]' }, { text: '(Sosa 2007, 23)', source: '[@sosa2007, 23]' }, { text: 'Smith 及 Doe (2010)', source: '@two2010' }, { text: '(2010)', source: '[-@two2010]' }]);
    expect([...view.dom.querySelectorAll('.live-md-citation')].map(chip => chip.textContent)).toEqual(['(Sosa 2007)', '(Sosa 2007, 23)', 'Smith 及 Doe (2010)', '(2010)']);
  });

  it('shows the source of the citations on the line the caret is on', () => {
    const view = editor(note, note.indexOf('另見'));
    expect(chips(view).map(chip => chip.source)).toEqual(['[@sosa2007]']);
    expect(view.dom.textContent).toContain('另見 [@sosa2007, 23]，@two2010 也說 [-@two2010]。');
  });

  it('leaves a citation with a key the bibliography lacks as source, and says which key', () => {
    const view = editor(note);
    expect(missing(view)).toEqual([{ source: '[@missing]', title: 'citation.missingKey missing' }, { source: '[@sosa2007; @gone]', title: 'citation.missingKey gone' }]);
    expect(view.dom.textContent).toContain('沒有 [@missing] 與 [@sosa2007; @gone]，@nobody 不算。');
  });

  it('leaves an assignee on a task line alone, even one named like a key', () => {
    const view = editor('- [ ] 問 @two2010 與 @alice，見 [@sosa2007]\n\nend');
    expect(chips(view)).toEqual([{ text: '(Sosa 2007)', source: '[@sosa2007]' }]);
    expect(view.dom.textContent).toContain('問 @two2010 與 @alice');
  });

  it('never changes the text', () => {
    const view = editor(note);
    expect(view.state.doc.toString()).toBe(note);
    view.dispatch({ selection: { anchor: 3 } });
    view.dispatch({ selection: { anchor: note.length } });
    expect(view.state.doc.toString()).toBe(note);
  });

  it('draws nothing outside a project', () => {
    const view = editor(note, note.length, []);
    expect(chips(view)).toEqual([]);
    expect(missing(view)).toEqual([]);
    expect(view.dom.querySelector('.live-md-citation')).toBeNull();
  });

  it('draws the citation, not a link, when its brackets also name a link reference', () => {
    const view = editor('見 [@sosa2007] 與 [23][@sosa2007]。\n\n[@sosa2007]: https://example.org\n\nend');
    expect(chips(view)).toEqual([{ text: '(Sosa 2007)', source: '[@sosa2007]' }, { text: '(Sosa 2007, 23)', source: '[23][@sosa2007]' }]);
    expect(view.dom.querySelector('.cm-line')!.textContent).toBe('見 (Sosa 2007) 與 (Sosa 2007, 23)。');
  });

  it('follows a library that arrives or changes after the editor opened', () => {
    const compartment = new Compartment();
    const view = editor('甲 [@sosa2007] 乙\n\nend', undefined, compartment.of(citationLibrary.of(null)));
    expect(chips(view)).toEqual([]);
    view.dispatch({ effects: compartment.reconfigure(citationLibrary.of(library)) });
    expect(chips(view)).toEqual([{ text: '(Sosa 2007)', source: '[@sosa2007]' }]);
    view.dispatch({ effects: compartment.reconfigure(citationLibrary.of(null)) });
    expect(chips(view)).toEqual([]);
  });
});

function complete(source: (context: CompletionContext) => CompletionResult | null, doc: string, extra: Extension = inProject, explicit = false) {
  const marker = doc.indexOf('|');
  const state = EditorState.create({ doc: doc.replace('|', ''), extensions: [extra] });
  return source(new CompletionContext(state, marker, explicit));
}
const labels = (result: CompletionResult | null) => result?.options.map(option => option.label);

describe('citation completion', () => {
  it('offers the keys of the bibliography inside citation brackets', () => {
    const result = complete(citationCompletionSource, '甲 [@so|');
    expect(labels(result)).toEqual(['sosa2007']);
    expect(result!.from).toBe(4);
    expect(result!.options[0]).toMatchObject({ detail: 'Sosa 2007 · A Virtue Epistemology', apply: 'sosa2007]' });
    expect(labels(complete(citationCompletionSource, '[@|'))).toEqual(['sosa2007', 'two2010', 'today']);
    expect(labels(complete(citationCompletionSource, '[-@tw|'))).toEqual(['two2010']);
    expect(labels(complete(citationCompletionSource, '[@sosa2007, 23; @tw|'))).toEqual(['two2010']);
  });

  it('matches the start of a key, an author or a word of the title, whatever the case', () => {
    expect(labels(complete(citationCompletionSource, '[@doe|'))).toEqual(['two2010']);
    expect(labels(complete(citationCompletionSource, '[@VIRT|'))).toEqual(['sosa2007']);
    expect(labels(complete(citationCompletionSource, '[@zzz|'))).toEqual([]);
  });

  it('closes the bracket only when it is not closed already', () => {
    expect(complete(citationCompletionSource, '[@so|] 乙')!.options[0]!.apply).toBe('sosa2007');
    expect(complete(citationCompletionSource, '[@so|, 23]')!.options[0]!.apply).toBe('sosa2007');
    expect(complete(citationCompletionSource, '[@so| 與 [連結](x)')!.options[0]!.apply).toBe('sosa2007]');
  });

  it('offers nothing outside citation brackets, after a locator, or outside a project', () => {
    expect(complete(citationCompletionSource, '甲 @so|')).toBeNull();
    expect(complete(citationCompletionSource, '[see @so|')).toBeNull();
    expect(complete(citationCompletionSource, '[@sosa2007, p. @so|')).toBeNull();
    expect(complete(citationCompletionSource, '[@sosa2007] @so|')).toBeNull();
    expect(complete(citationCompletionSource, '[@so|', [])).toBeNull();
  });

  it('leaves the bracket to the citations and every other @ to the task tokens', () => {
    expect(complete(atCompletionSource, '[@to|')).toBeNull();
    expect(complete(atCompletionSource, '[@sosa2007; @to|')).toBeNull();
    expect(labels(complete(atCompletionSource, '甲 @to|'))).toEqual(['today', 'tomorrow']);
    expect(labels(complete(atCompletionSource, '[see @to|'))).toEqual(['today', 'tomorrow']);
    // Outside a project the brackets mean nothing, as before.
    expect(labels(complete(atCompletionSource, '[@to|', []))).toEqual(['today', 'tomorrow']);
  });
});
