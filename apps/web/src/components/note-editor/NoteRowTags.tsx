import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { cleanTag, noteTags, suggestTags, withoutTag, withTag } from './tag-edit.js';

interface NoteRowTagsProps {
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  /** The notebook's tags, offered as the field is typed in. */
  availableTags: string[];
  locked: boolean;
}

const COMPACT_BELOW = 200;

/** The note's tags as chips in the note row: each removable, a field that adds one with autocomplete, and a +N that lists them all when the row is too narrow for every chip. */
export function NoteRowTags({ metadata, setMetadata, availableTags, locked }: NoteRowTagsProps) {
  const { t } = useTranslation();
  const tags = useMemo(() => noteTags(metadata), [metadata]);
  const [input, setInput] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Too little room for the field beside the chips: it folds into a + button that opens it as a popover.
  const [compact, setCompact] = useState(false);
  const [adding, setAdding] = useState(false);
  const suggestions = useMemo(() => suggestTags(availableTags, tags, input), [availableTags, tags, input]);
  const list = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(tags.length);
  // The chips that fit whole in the row; the rest are hidden behind +N until it is opened.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || expanded) return;
    const measure = () => {
      const items = [...element.children];
      const right = element.getBoundingClientRect().right;
      const count = items.findIndex(item => item.getBoundingClientRect().right > right + 1);
      setFit(count === -1 ? items.length : count);
    };
    measure();
    // Without ResizeObserver (a test DOM) the row is measured once.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tags, expanded]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // A width of 0 is an unlaid-out row (hidden, or a test DOM), not a narrow one.
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      setCompact(width > 0 && width < COMPACT_BELOW);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [locked, tags.length === 0]);
  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);
  const folded = compact && !adding;
  const hidden = expanded ? 0 : Math.max(0, tags.length - fit);
  const add = (raw: string) => {
    if (cleanTag(raw)) setMetadata(withTag(metadata, raw));
    setInput('');
    setSuggesting(false);
    setAdding(false);
  };
  if (!tags.length && locked) return null;
  return (
    <div
      ref={root}
      className='note-tags'
      data-compact={compact || undefined}
      role='group'
      aria-label={t('editor.tags')}
      data-escape-local=''
      data-expanded={expanded || undefined}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExpanded(false);
          setSuggesting(false);
          setAdding(false);
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && (expanded || suggesting || adding)) {
          event.stopPropagation();
          setExpanded(false);
          setSuggesting(false);
          setAdding(false);
        }
      }}
    >
      <ul ref={list} className='note-tag-list'>
        {tags.map((tag, index) => (
          <li key={tag} className='note-tag' data-clipped={!expanded && index >= fit ? true : undefined}>
            <span>{tag}</span>
            {!locked && (
              <button
                type='button'
                className='note-tag-remove'
                aria-label={t('editor.removeTag', { tag })}
                title={t('editor.removeTag', { tag })}
                onClick={() => setMetadata(withoutTag(metadata, tag))}
              >
                <X aria-hidden='true' />
              </button>
            )}
          </li>
        ))}
      </ul>
      {tags.length > 0 && (hidden > 0 || expanded) && <button type='button' className='note-tag-more' aria-expanded={expanded} aria-label={t('editor.moreTags', { count: tags.length - fit })} onClick={() => setExpanded(open => !open)}>{expanded ? <X aria-hidden='true' /> : `+${hidden}`}</button>}
      {!locked && folded && (
        <button type='button' className='note-tag-add-button' aria-label={t('editor.addTagShort')} title={t('editor.addTagShort')} onClick={() => { setExpanded(false); setAdding(true); }}>
          <Plus aria-hidden='true' />
        </button>
      )}
      {!locked && !folded && (
        <div className='note-tag-add' data-popover={compact || undefined}>
          <input
            ref={field}
            type='text'
            className='note-tag-input'
            aria-label={t('editor.addTagShort')}
            placeholder={t('editor.addTagShort')}
            value={input}
            autoComplete='off'
            onChange={event => {
              setInput(event.target.value);
              setSuggesting(true);
            }}
            onFocus={() => setSuggesting(true)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                add(input);
              }
            }}
          />
          {suggesting && suggestions.length > 0 && <div className='note-tag-suggestions' role='listbox' aria-label={t('editor.suggestions')}>{suggestions.slice(0, 8).map(tag => <button key={tag} type='button' role='option' aria-selected={false} onMouseDown={event => event.preventDefault()} onClick={() => add(tag)}>{tag}</button>)}</div>}
        </div>
      )}
    </div>
  );
}
