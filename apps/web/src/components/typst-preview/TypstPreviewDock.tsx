import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { TypstPreviewProject, TypstToolkitStatus } from '../../lib/api.js';
import { onDockReserve, reservedDockWidth, reserveDockWidth } from '../../lib/dock-reserve.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { openPdfBytes, type PdfDocument } from '../../lib/pdf/pdf-document.js';
import { maxPreviewDockWidth, MIN_PREVIEW_DOCK_WIDTH, PREVIEW_DOCK_KEY_STEP, previewDock, previewDockWidth, usePreviewDock } from '../../lib/typst-preview/dock-store.js';
import { type PreviewNote, usePreviewTarget, useTypstPreviewEnabled } from '../../lib/typst-preview/preview-target.js';
import { type PreviewJob, usePreviewCompile } from '../../lib/typst-preview/use-preview-compile.js';
import { usePreviewProject } from '../../lib/typst-preview/use-preview-project.js';
import { usePhone } from '../../lib/use-phone.js';
import { drawPage, PreviewPages, type PreviewPagesHandle, type PreviewView } from './PreviewPages.js';
import './typst-preview.css';

/** The padding on each side of the pages (see `.typst-preview-pages`). */
const PAGES_PADDING = 12;
const INSTALL_COMMAND = 'npm install thesis-toolkit@latest';

interface Shown {
  note: PreviewNote;
  project: TypstPreviewProject;
  toolkit: TypstToolkitStatus;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  useLayoutEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

const assistantWidth = () => reservedDockWidth('assistant');

/**
 * The typeset PDF of the thesis-toolkit project the active note belongs to, in a column between the page and the
 * assistant dock (local workspaces only, 768px and wider). It compiles when it opens, after each local save of a note
 * in the project, and from its button; a new revision replaces the pages with the reader's place kept, and a failed
 * compile keeps the last good pages under the error. When the active note leaves the project, the dock keeps showing it.
 */
export function TypstPreviewDock(props: { /** Opens a compiled PDF; tests pass a fake. */ openPdf?: (bytes: Uint8Array) => Promise<PdfDocument>; }) {
  // A remote workspace has no preview: nothing renders and the server is asked nothing.
  return useTypstPreviewEnabled() ? <OfferedDock {...props} /> : null;
}

function OfferedDock({ openPdf = openPdfBytes }: { openPdf?: (bytes: Uint8Array) => Promise<PdfDocument>; }) {
  const { t } = useTranslation();
  const phone = usePhone();
  const dock = usePreviewDock();
  const target = usePreviewTarget();
  const answer = usePreviewProject(target?.notebookId, target?.path);
  const [shown, setShown] = useState<Shown | null>(null);
  // The project last seen stays on screen when the active note leaves it; state derived while rendering, as React allows.
  if (target && answer?.project && answer.toolkit && (shown?.note !== target || shown.project !== answer.project || shown.toolkit !== answer.toolkit)) setShown({ note: target, project: answer.project, toolkit: answer.toolkit });
  const visible = !phone && dock.open && shown !== null;

  const projectKey = shown ? `${shown.note.notebookId ?? ''}:${shown.project.directory}` : '';
  const remembered = dock.targets[projectKey];
  const chosen = shown ? (remembered !== undefined && shown.project.targets.includes(remembered) ? remembered : shown.project.defaultTarget) : '';
  const ready = visible && shown.toolkit.ok;
  const notePath = shown?.note.path, noteNotebook = shown?.note.notebookId, directory = shown?.project.directory;
  const job = useMemo<PreviewJob | null>(() => ready && notePath && directory ? { key: `${projectKey}:${chosen}`, path: notePath, notebookId: noteNotebook, directory, target: chosen } : null, [ready, projectKey, chosen, notePath, noteNotebook, directory]);
  const { pdf, failure, compiling, durationMs, compile } = usePreviewCompile(job);

  const viewport = useViewportWidth();
  const beside = useSyncExternalStore(onDockReserve, assistantWidth, assistantWidth);
  const width = previewDockWidth(dock.width, viewport, beside);
  useLayoutEffect(() => {
    reserveDockWidth('typst-preview', visible ? width : 0);
    return () => reserveDockWidth('typst-preview', 0);
  }, [visible, width]);
  const pagesWidth = width - 2 * PAGES_PADDING;
  const drawWidth = useRef(pagesWidth);
  useEffect(() => {
    drawWidth.current = pagesWidth;
  }, [pagesWidth]);

  // The pages on screen: the last PDF that opened, kept until the next one is ready to take its place.
  const [opened, setOpened] = useState<{ key: string; view: PreviewView; } | null>(null);
  const pages = useRef<PreviewPagesHandle>(null);
  const jobKey = job?.key ?? '';
  // Pages of another project or target are not this one's.
  const view = opened?.key === jobKey ? opened.view : null;
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    // Read before the new document opens: the pages around this place are drawn first, and the scroll returns to it.
    const place = pages.current?.place() ?? null;
    void (async () => {
      let document: PdfDocument | undefined;
      try {
        // pdf.js takes the buffer over, so it gets a copy and the bytes stay usable.
        document = await openPdf(pdf.bytes.slice());
        const sizes = await Promise.all(Array.from({ length: document.pageCount }, (_unused, index) => document!.pageSize(index + 1)));
        const first = Math.min(place?.page ?? 1, document.pageCount);
        const drawn = new Map<number, HTMLCanvasElement>(), drawnWidth = drawWidth.current;
        await Promise.all(
          [first, first + 1].filter(page => page >= 1 && page <= document!.pageCount).map(async page => {
            const drawing = drawPage(document!, page, drawnWidth);
            await drawing.done;
            drawn.set(page, drawing.canvas);
          }),
        );
        if (cancelled) return void document.destroy();
        setOpened({ key: jobKey, view: { revision: pdf.revision, document, sizes, drawn, drawnWidth, place } });
      } catch (error) {
        void document?.destroy();
        if (!cancelled) console.warn(`[typst-preview] the compiled PDF could not be shown: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, openPdf, jobKey]);
  // A document that left the screen is closed.
  const openedDocument = opened?.view.document;
  useEffect(() => openedDocument ? () => void openedDocument.destroy() : undefined, [openedDocument]);

  if (!visible) return null;
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    // The dock's right edge stays where its neighbour is, so its width is the distance from there to the pointer.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) previewDock.setWidth((event.currentTarget.parentElement?.getBoundingClientRect().right ?? window.innerWidth) - event.clientX, window.innerWidth, beside);
  };
  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? PREVIEW_DOCK_KEY_STEP : event.key === 'ArrowRight' ? -PREVIEW_DOCK_KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    previewDock.setWidth(width + step, window.innerWidth, beside);
  };
  const { project, toolkit } = shown;
  const setup = toolkit.ok ? null : toolkit.code === 'unsupported-platform' ? { text: t('typstPreview.setup.unsupported') } : { text: toolkit.code === 'too-old' ? t('typstPreview.setup.tooOld', { version: toolkit.version ?? '' }) : t('typstPreview.setup.missing'), command: INSTALL_COMMAND };
  return (
    <div id='typst-preview-dock' className='typst-preview-dock' style={{ width }}>
      <div className='typst-preview-dock-header'>
        <span className='typst-preview-dock-title' title={`${project.name} / ${chosen}`}>{project.name}{' / '}{chosen}</span>
        {!setup && <span className='typst-preview-dock-status' aria-live='polite'>{compiling ? t('typstPreview.compiling') : durationMs !== undefined && !failure ? t('typstPreview.compiled', { seconds: (durationMs / 1000).toFixed(1) }) : ''}</span>}
        {!setup && project.targets.length > 1 && <select className='typst-preview-dock-target' aria-label={t('typstPreview.target')} value={chosen} onChange={event => previewDock.setTarget(projectKey, event.target.value)}>{project.targets.map(name => <option key={name} value={name}>{name}</option>)}</select>}
        {!setup && <button type='button' className='ui-icon-button' aria-label={t('typstPreview.recompile')} title={t('typstPreview.recompile')} onClick={compile}>{compiling ? <LoaderCircle aria-hidden='true' className='typst-preview-spin' /> : <RefreshCw aria-hidden='true' />}</button>}
        <button type='button' className='ui-icon-button' aria-label={t('typstPreview.close')} title={t('typstPreview.close')} onClick={previewDock.close}>
          <X aria-hidden='true' />
        </button>
      </div>
      {setup && (
        <div className='typst-preview-setup' role='status'>
          <p>{setup.text}</p>
          {setup.command && <code>{setup.command}</code>}
        </div>
      )}
      {!setup && failure && (
        <div className='typst-preview-error' role='alert'>
          <p>{failure.message || t('typstPreview.failedFirst')}</p>
          <p className='typst-preview-error-note'>{t(view ? 'typstPreview.failed' : 'typstPreview.failedFirst')}</p>
          {failure.log && (
            <details>
              <summary>{t('typstPreview.log')}</summary>
              <pre>{failure.log}</pre>
            </details>
          )}
        </div>
      )}
      {!setup && view ? <PreviewPages ref={pages} view={view} width={pagesWidth} stale={Boolean(failure)} pageLabel={page => t('typstPreview.page', { page })} /> : <div className='typst-preview-pages' />}
      <div className='assistant-dock-resizer' role='separator' aria-orientation='vertical' aria-label={t('typstPreview.resize')} aria-valuenow={width} aria-valuemin={MIN_PREVIEW_DOCK_WIDTH} aria-valuemax={maxPreviewDockWidth(viewport, beside)} tabIndex={0} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={resizeByKey} />
    </div>
  );
}
