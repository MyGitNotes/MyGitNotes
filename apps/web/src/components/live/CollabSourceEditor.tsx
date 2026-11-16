import { forwardRef, type MutableRefObject, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { LiveMarkdownHandle } from '../LiveMarkdownEditor.js';

/** Plain source as the direct editor's Source text area shows it: no Markdown styling, which would read the frontmatter's `---` as a heading rule. */
const sourceTheme = EditorView.theme({ '.cm-content': { padding: '12px 16px', fontFamily: 'var(--font-mono, ui-monospace, monospace)' } });

interface CollabSourceEditorProps {
  text: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  showLineNumbers?: boolean;
  ariaLabel: string;
  /** The editor's scrolling element, which a split view keeps in step with its preview. */
  scroller?: MutableRefObject<HTMLElement | null>;
}

/**
 * The collab editor's Source mode: the whole live text, frontmatter included, as plain Markdown source in its own
 * CodeMirror view, plain text with no Markdown styling, bound to the same `Y.Text` and undo manager as the live view, so typing reaches everyone.
 */
export const CollabSourceEditor = forwardRef<LiveMarkdownHandle, CollabSourceEditorProps>(({ text, awareness, undoManager, showLineNumbers = true, ariaLabel, scroller }, ref) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const gutter = useRef(new Compartment());
  useImperativeHandle(ref, () => ({
    ready: () => Boolean(view.current),
    focus: () => view.current?.focus(),
    getSelection: () => {
      const main = view.current?.state.selection.main;
      return main ? { from: main.from, to: main.to } : null;
    },
    insert: (inserted, at) => {
      const current = view.current;
      if (!current) return;
      current.dispatch(at === undefined ? current.state.replaceSelection(inserted) : { changes: { from: at, insert: inserted } });
    },
    insertBlock: block => view.current?.dispatch(view.current.state.replaceSelection(block)),
    revealRange: (from, to, focus = false) => {
      const current = view.current;
      if (!current) return;
      const start = Math.max(0, Math.min(from, current.state.doc.length)), end = Math.max(start, Math.min(to, current.state.doc.length));
      current.dispatch({ selection: { anchor: start, head: end }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
      if (focus) current.focus();
    },
    goToLine: (line, options = {}) => {
      const current = view.current;
      if (!current) return;
      const target = current.state.doc.line(Math.max(1, Math.min(line, current.state.doc.lines))).from;
      current.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 20 }) });
      if (options.focus !== false) current.focus();
    },
    getCurrentLine: () => {
      const current = view.current;
      return current ? current.state.doc.lineAt(current.viewport.from).number : 1;
    },
    format: () => {},
    outline: () => {},
  }), []);
  /* eslint-disable react-hooks/exhaustive-deps -- The view is built once per shared text; line numbers reconfigure it below. */
  useEffect(() => {
    const created = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          yCollab(text, awareness, { undoManager }),
          Prec.high(keymap.of(yUndoManagerKeymap)),
          gutter.current.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
          EditorView.lineWrapping,
          sourceTheme,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'role': 'textbox', 'aria-multiline': 'true', 'data-key-scope': 'markdown-editor' }),
        ],
      }),
    });
    view.current = created;
    if (scroller) scroller.current = created.scrollDOM;
    return () => {
      if (scroller) scroller.current = null;
      created.destroy();
      view.current = undefined;
    };
  }, [text, awareness, undoManager]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    view.current?.dispatch({ effects: gutter.current.reconfigure(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []) });
  }, [showLineNumbers]);
  return <div ref={host} className='flex-1 min-h-0 min-w-0 overflow-hidden live-collab-source' data-live-source />;
});
CollabSourceEditor.displayName = 'CollabSourceEditor';
