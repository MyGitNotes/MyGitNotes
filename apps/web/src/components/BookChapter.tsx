import { type ReactNode, useMemo, useState } from 'react';
import { ExternalLink, FileText, Pencil, Play } from 'lucide-react';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { BookChapter as Chapter, BookEntry } from '../lib/book-chapters.js';
import { useTranslation } from '../lib/i18n/index.js';
import { BookFolder } from './BookFolder.js';
import { BookSection } from './BookSection.js';
import type { CompilationAsset } from './CompilationCard.js';
import { LoadingStatus } from './LoadingStatus.js';
import { Button } from './Button.js';
import { NoteHtml } from './NoteHtml.js';
import { wholeNoteItem } from '../lib/compilation-content.js';
import { renderNote } from '../lib/markdown.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { useNoteEditing } from '../lib/note-editing.js';

export interface BookChapterProps {
  chapter: Chapter;
  assets: CompilationAsset[];
  writable: boolean;
  onOpen: (item: CompilationItem, note?: NoteListItem) => void;
  onLiveTitle: (anchor: string, title: string | undefined) => void;
  onEntries: (chapterId: string, entries: BookEntry[], leaving?: boolean) => void;
  /** 1 for an item under a chapter heading, which sits one heading level down; 0 otherwise. */
  depth?: 0 | 1;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** A chapter that is not a note section: a heading with the title, then what the item shows. */
function ChapterFrame({ chapter, depth, onOpen, children }: { chapter: Chapter; depth: 0 | 1; onOpen: BookChapterProps['onOpen']; children: ReactNode; }) {
  const { t } = useTranslation();
  const { item, title, anchor } = chapter;
  const Heading = depth ? 'h3' : 'h2';
  return (
    <section className='compilation-book-section' data-level={2 + depth} data-kind={item.kind}>
      <div className='compilation-book-heading-row'>
        <Heading className='compilation-book-heading' data-book-anchor={anchor} tabIndex={-1}>
          <button type='button' className='compilation-book-title' title={title} onClick={() => onOpen(item, chapter.note)}>{title}</button>
        </Heading>
        {item.kind !== 'note' && (
          <button type='button' className='screen-open ui-icon-button' aria-label={`${t('links.open')}: ${title}`} onClick={() => onOpen(item, chapter.note)}>
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      <div className='compilation-book-content'>{children}</div>
    </section>
  );
}

function YouTubeChapter({ item, title }: { item: Extract<CompilationItem, { kind: 'youtube'; }>; title: string; }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  return playing ? <iframe title={title} src={`https://www.youtube-nocookie.com/embed/${item.videoId}?start=${item.start}&playsinline=1&autoplay=1&rel=0`} allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share' allowFullScreen referrerPolicy='strict-origin-when-cross-origin' /> : (
    <button type='button' className='screen-youtube-poster' onClick={() => setPlaying(true)} aria-label={`${t('screen.play')}: ${title}`}>
      <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt='' loading='lazy' />
      <span>
        <Play fill='currentColor' />
        {t('screen.play')}
      </span>
    </button>
  );
}

/**
 * A heading-anchored note: its heading's section only, titled with the heading as the note has it. It never edits in
 * place (one note, one draft, one editor): Edit and the title open the whole note in zoom at the heading, and a click on
 * the body does nothing. A heading that is gone shows the missing notice and a way to open the whole note.
 */
function AnchoredChapter({ chapter, depth, writable, onOpen }: Pick<BookChapterProps, 'chapter' | 'writable' | 'onOpen'> & { depth: 0 | 1; }) {
  const { t } = useTranslation();
  const { editorProps } = useNoteEditing();
  const { item, note, section, title, anchor } = chapter;
  const tableLabel = t('preview.scrollableTable');
  const html = useMemo(() => section && note ? renderNote(section.body, note.path, tableLabel, youtubeLabels(t), note.notebookId) : '', [section, note, tableLabel, t]);
  if (item.kind !== 'note' || !note) return null;
  const Heading = depth ? 'h3' : 'h2';
  const label = t('compilation.editNote', { title });
  const editable = writable && section && !editorProps({ ...note, content: note.content ?? '' }).readOnly;
  return (
    <section className='compilation-book-section' data-level={2 + depth} data-kind='note' data-anchored>
      <div className='compilation-book-heading-row'>
        <Heading className='compilation-book-heading' data-book-anchor={anchor} tabIndex={-1}>
          <button type='button' className='compilation-book-title' title={title} onClick={() => onOpen(item, note)}>{title}</button>
        </Heading>
        {editable && (
          <Button size='small' className='compilation-edit-toggle' aria-label={label} title={label} onClick={() => onOpen(item, note)}>
            <Pencil aria-hidden='true' />
            <span>{t('editor.startEditing')}</span>
          </Button>
        )}
      </div>
      <div className='compilation-book-content'>
        {section ? <NoteHtml className='prose-custom screen-markdown' html={html} notebookId={note.notebookId} /> : typeof note.content !== 'string' ? <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus> : (
          <div className='screen-heading-missing'>
            <p className='screen-missing'>{t('screen.headingMissing')}</p>
            <Button onClick={() => onOpen(wholeNoteItem(item), note)}>{t('screen.openWholeNote')}</Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** A chapter heading: its title as plain text, nothing to open, then its items one level down, or a notice when it has none. */
function HeadingChapter({ chapter, ...props }: BookChapterProps) {
  const { t } = useTranslation();
  const members = chapter.members ?? [];
  return (
    <section className='compilation-book-section compilation-book-chapter' data-level={2} data-kind='heading'>
      <div className='compilation-book-heading-row'>
        <h2 className='compilation-book-heading' data-book-anchor={chapter.anchor} tabIndex={-1}>
          <span className='compilation-book-title' title={chapter.title}>{chapter.title}</span>
        </h2>
      </div>
      <div className='compilation-book-chapter-items'>{members.length ? members.map(member => <BookChapter key={member.id} {...props} chapter={member} depth={1} />) : <p className='screen-summary'>{t('book.emptyChapter')}</p>}</div>
    </section>
  );
}

/** One chapter of the book, by kind: a chapter heading with its items, a note section, an asset, a video, a folder's note sections, or a missing notice in place. */
export function BookChapter(props: BookChapterProps) {
  const { chapter, assets, writable, onOpen, onLiveTitle, onEntries, depth = 0 } = props;
  const { t } = useTranslation();
  const { item, note, asset, title, anchor } = chapter;
  if (item.kind === 'heading') return <HeadingChapter {...props} />;
  if (item.kind === 'note' && note && item.anchor) return <AnchoredChapter chapter={chapter} depth={depth} writable={writable} onOpen={onOpen} />;
  if (item.kind === 'note' && note) {
    return <BookSection anchor={anchor} slot={item.id} level={depth ? 3 : 2} note={note} writable={writable} onOpenZoom={() => onOpen(item, note)} onLiveTitle={onLiveTitle} />;
  }
  if (item.kind === 'folder' && !chapter.missing) {
    return (
      <section className='compilation-book-section' data-level={2 + depth} data-kind='folder'>
        <BookFolder item={item} anchor={anchor} title={title} level={depth ? 3 : 2} assets={assets} writable={writable} onOpen={onOpen} onLiveTitle={onLiveTitle} onEntries={onEntries} />
      </section>
    );
  }
  return (
    <ChapterFrame chapter={chapter} depth={depth} onOpen={onOpen}>
      {item.kind === 'note' && !chapter.missing ? <LoadingStatus className='screen-summary'>{t('notes.loading')}</LoadingStatus> : item.kind === 'asset' && asset
        ? IMAGE.test(asset.name)
          ? (
            <button type='button' className='screen-image-button' onClick={() => onOpen(item)} aria-label={`${t('screen.preview')}: ${title}`}>
              <img src={asset.rawUrl} alt={asset.name} loading='lazy' />
            </button>
          )
          : (
            <div className='screen-file'>
              <FileText size={38} />
              <p>{asset.name}</p>
              <small>{Math.ceil(asset.size / 1024)}{' KB'}</small>
            </div>
          )
        : item.kind === 'youtube'
        ? <YouTubeChapter item={item} title={title} />
        : <p className='screen-missing'>{t('screen.missing')}</p>}
    </ChapterFrame>
  );
}
