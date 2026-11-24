import path from 'node:path';
import { assetInfo, assetRoot, isAssetPath } from '../assets.js';
import { StaleRevisionError } from '../repository.js';
import { parseNoteContent } from '../frontmatter.js';
import { isCompilationPath } from '../compilation.js';
import { isOutlinePath } from '../outline.js';
import { isNoteFile, NOTE_EXTENSIONS, parseNoteFile } from '../note-file.js';
import { describeNoteTemplate, formatTemplateDate, formatTemplateTime, isTemplateFile, lastUseOf, type ListedNoteTemplate, notebookTemplateEntries, type NoteTemplateEntry, type NoteTemplateInfo, type RenderedNoteTemplate, renderNoteTemplate, templateFileId, templateLastUse, TEMPLATES_FOLDER, templateValues } from '../templates.js';
import { isNotebookContent, parseFolderConfig, sortFolders } from '../folders.js';
import { FolderItem, NotebookConfig, NoteItem } from '../types.js';
import { SourceError } from '../github-api.js';
import { hashJson, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL } from '../remote-cache.js';
import type { RepositoryCatalog } from '../note-catalog.js';
import type { NoteListItem } from '../note-query.js';
import { type LiveLink, liveNoteState } from '../live-repository.js';
import type { RemoteEntry } from './types.js';
import { HistorySource } from './history.js';

const INDEX_VERSION = 'v4';
/** The shape of a cached template list; a change of `NoteTemplateInfo` or of how a template is described raises it. */
const TEMPLATES_VERSION = 'v1';

/** A remote reader's note read model: notes, notebook indexes and the catalog, templates, folders and assets. */
export abstract class NoteSource extends HistorySource {
  /** One note; a checked-out note is read fresh from the live editor and carries `live`. */
  async note(file: string): Promise<NoteItem> {
    return this.noteOf(file, true);
  }
  /** One note; with `fresh` false a live text this request already loaded is used, as bulk reads do. */
  private async noteOf(file: string, fresh: boolean): Promise<NoteItem> {
    const config = await this.config();
    const link = await this.liveLink(file);
    // A template file directly in `.templates/` is read like a note, so its editor opens it; no other dot path is but a pending live note's.
    const nb = link?.notebook ?? config.notebooks.find(n => file.startsWith(`${n.root}/`) && (isNotebookContent(file.slice(n.root.length + 1), n) || templateFileId(file.slice(n.root.length + 1)) !== undefined));
    if (!nb || !isNoteFile(file)) throw new SourceError('Path is not a configured note.', 403);
    const raw = link ? (fresh ? await this.readLiveLink(link) : await this.liveTextOf(link)).content : (await this.readFile(file)).toString('utf8');
    const { metadata, content, title, lineNumberOffset, extra } = parseNoteFile(raw, file, config.notebooks.map(item => item.root));
    return { id: typeof metadata.id === 'string' ? metadata.id : file, path: file, notebookId: nb.id, title, metadata, content, lineNumberOffset, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), revision: (await this.getSnapshot()).sha, ...extra, ...(link ? { live: liveNoteState(link.checkout, this.live!.retargets) } : {}) };
  }

  /** Ordinary notes by default; `allKinds` includes outlines and compilations. */
  private notebookFiles(nb: NotebookConfig, entries: RemoteEntry[], allKinds = false) {
    const templateFiles = new Set((nb.templates || []).map(t => t.file));
    return entries.filter(e => e.type === 'blob' && e.mode !== '120000' && e.path.startsWith(`${nb.root}/`) && isNotebookContent(e.path.slice(nb.root.length + 1), nb) && !templateFiles.has(e.path.slice(nb.root.length + 1)) && (NOTE_EXTENSIONS.test(e.path) && (allKinds || !isOutlinePath(e.path)) || allKinds && isCompilationPath(e.path)));
  }

  /** Note paths of one notebook, taken from the snapshot tree without reading any file, and its pending live notes' virtual paths. */
  async notePaths(nb: NotebookConfig): Promise<string[]> {
    const { entries } = await this.getSnapshot();
    const { away, added } = await this.liveOverlay(nb);
    return [...this.notebookFiles(nb, entries).map(entry => entry.path).filter(file => !away.has(file)), ...added.map(link => link.path)];
  }

  private notebookKey(kind: string, notebooks: NotebookConfig[], entries: RemoteEntry[]) {
    return `mgn:${kind}:${INDEX_VERSION}:${this.cacheRepository()}:${hashJson(notebooks.map(nb => [nb.id, nb.root, nb.assets || 'assets', (nb.templates || []).map(t => t.file), entries.find(entry => entry.type === 'tree' && entry.path === nb.root)?.sha || null]))}`;
  }

  /** Query read model over this reader's snapshot. Notebook indexes and derived results are cached by notebook content. */
  catalog(): RepositoryCatalog {
    const local = new Map<string, Promise<NoteListItem[]>>();
    let folders: Promise<FolderItem[]> | undefined;
    return {
      folders: async nb => (await (folders ??= this.folders())).filter(folder => folder.notebookId === nb.id),
      revision: async (fresh = false) => (await this.getSnapshot(fresh)).sha,
      dates: notes => this.editFacts(notes.map(note => note.path)),
      template: async (nb, file) => {
        const { entries } = await this.getSnapshot();
        if (!isTemplateFile(file.slice(nb.root.length + 1), nb) || !entries.some(entry => entry.path === file && entry.type === 'blob' && entry.mode !== '120000')) return undefined;
        return this.note(file);
      },
      index: nb => {
        let pending = local.get(nb.id);
        if (!pending) {
          pending = this.notebookIndex(nb).then(items => this.liveIndex(nb, items));
          local.set(nb.id, pending);
        }
        return pending;
      },
      contents: async notes => {
        await this.prefetchFiles(notes.map(note => note.path));
        await this.prefetchLive(notes.map(note => note.path));
        const result = new Map<string, string>();
        for (let i = 0; i < notes.length; i += 6) {
          await Promise.all(notes.slice(i, i + 6).map(async note => result.set(note.path, parseNoteFile((await this.readFile(note.path)).toString('utf8'), note.path).content)));
        }
        return result;
      },
      memo: async <T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T> => {
        const { entries } = await this.getSnapshot();
        if (!this.cache || notebooks.some(nb => !entries.some(entry => entry.type === 'tree' && entry.path === nb.root))) return compute();
        // Derived results of notebooks with live notes are kept per state of their live texts, so none mixes two states.
        const key = this.notebookKey(kind, notebooks, entries) + await this.liveMemoKey(notebooks);
        const [hit] = await this.cache.get([key]);
        if (hit !== null) {
          try {
            return JSON.parse(hit) as T;
          } catch { /* A damaged value is recomputed. */ }
        }
        const value = await compute();
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
        return value;
      },
    };
  }

  /**
   * The index of a notebook with its live links laid over it: a checked-out note takes its title, metadata, tags, status
   * and size from its live text, and a pending note is added at its virtual path. The Git index under it is never changed.
   */
  private async liveIndex(nb: NotebookConfig, items: NoteListItem[]): Promise<NoteListItem[]> {
    const { links, away, added } = await this.liveOverlay(nb);
    if (!links.length) return items;
    const scope = (await this.config()).notebooks.map(item => item.root);
    if (links.length > 500) console.warn(`[live-notes] ${links.length} live links in one notebook; the overlay reads only what a request needs`);
    const listed = new Set(items.map(item => item.path));
    const shown = links.filter(link => added.includes(link) || listed.has(link.path));
    await this.loadLiveTexts(shown);
    const revision = (await this.getSnapshot()).sha;
    const item = (link: LiveLink): NoteListItem => {
      const raw = this.liveLoaded.get(link.path)!.content;
      const { metadata, title, extra } = parseNoteFile(raw, link.path, scope);
      return { id: typeof metadata.id === 'string' ? metadata.id : link.path, path: link.path, notebookId: nb.id, title, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), ...extra, revision, live: liveNoteState(link.checkout, this.live!.retargets) };
    };
    const byPath = new Map(shown.map(link => [link.path, link]));
    return [...items.filter(entry => !away.has(entry.path)).map(entry => byPath.has(entry.path) && !added.includes(byPath.get(entry.path)!) ? item(byPath.get(entry.path)!) : entry), ...added.map(item)];
  }

  /** The Git index of a notebook, cached by its tree: it never holds a live text. */
  private async notebookIndex(nb: NotebookConfig): Promise<NoteListItem[]> {
    const snapshot = await this.getSnapshot();
    const { sha, entries } = snapshot;
    // A compilation's validity depends on every notebook root of the repository, so the index key carries them.
    const scope = (await this.config()).notebooks.map(item => item.root);
    if (!entries.some(entry => entry.type === 'tree' && entry.path === nb.root)) return [];
    const key = this.cache ? `${this.notebookKey('index', [nb], entries)}:${hashJson(scope)}` : '';
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    let items: NoteListItem[] | undefined;
    if (hit !== null) {
      try {
        items = JSON.parse(hit) as NoteListItem[];
      } catch { /* A damaged value is rebuilt. */ }
    }
    if (!Array.isArray(items) || items.some(item => typeof item?.path !== 'string' || typeof item?.title !== 'string' || item?.notebookId !== nb.id || !Array.isArray(item?.tags) || typeof item?.metadata !== 'object' || item?.metadata === null)) items = undefined;
    if (!items) {
      const files = this.notebookFiles(nb, entries, true);
      await this.prefetchFiles(files.map(file => file.path));
      items = [];
      for (let i = 0; i < files.length; i += 6) {
        items.push(
          ...await Promise.all(
            files.slice(i, i + 6).map(async file => {
              const raw = (await this.readSnapshotFile(snapshot, file.path)).toString('utf8');
              const { metadata, title, extra } = parseNoteFile(raw, file.path, scope);
              return { id: typeof metadata.id === 'string' ? metadata.id : file.path, path: file.path, notebookId: nb.id, title, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), ...extra } satisfies NoteListItem;
            }),
          ),
        );
      }
      const text = JSON.stringify(items);
      if (this.cache && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    }
    return items.map(item => ({ ...item, revision: sha }));
  }

  /** The notebook's template entries: the manifest's, then the `.templates/` files of this snapshot. */
  private async templateEntries(nb: NotebookConfig): Promise<NoteTemplateEntry[]> {
    const { entries } = await this.getSnapshot();
    const prefix = `${nb.root}/${TEMPLATES_FOLDER}/`;
    return notebookTemplateEntries(nb, entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && entry.path.startsWith(prefix)).map(entry => entry.path.slice(nb.root.length + 1)));
  }
  private async readTemplate(nb: NotebookConfig, entry: NoteTemplateEntry) {
    const raw = (await this.readFile(`${nb.root}/${entry.file}`)).toString('utf8');
    const { metadata, content } = parseNoteContent(raw, path.posix.basename(entry.file));
    return { metadata, content, raw };
  }

  /**
   * The parsed template list of one notebook. It is cached by the content of its template files, never by time: the key
   * holds the `.templates` tree and the blobs of the manifest's template files, so an edited template is a new key and a
   * commit that leaves them alone reads no file.
   */
  private async notebookTemplates(nb: NotebookConfig): Promise<NoteTemplateInfo[]> {
    const listed = await this.templateEntries(nb);
    if (!listed.length) return [];
    const { entries } = await this.getSnapshot();
    const blob = (file: string) => entries.find(entry => entry.path === `${nb.root}/${file}` && entry.type === 'blob' && entry.mode !== '120000')?.sha ?? null;
    // A snapshot that lists no tree for the folder is keyed by the folder's files themselves.
    const folder = entries.find(entry => entry.type === 'tree' && entry.path === `${nb.root}/${TEMPLATES_FOLDER}`)?.sha ?? listed.filter(entry => entry.source === 'file').map(entry => [entry.file, blob(entry.file)]);
    const key = this.cache ? `mgn:templates:${TEMPLATES_VERSION}:${this.cacheRepository()}:${hashJson([nb.id, nb.root, folder, (nb.templates || []).map(template => [template.id, template.title, template.file, blob(template.file)])])}` : '';
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    if (hit !== null) {
      try {
        const cached = JSON.parse(hit) as NoteTemplateInfo[];
        if (Array.isArray(cached) && cached.every(item => typeof item?.id === 'string' && typeof item?.name === 'string' && typeof item?.file === 'string' && item?.notebookId === nb.id && Array.isArray(item?.placeholders))) return cached;
      } catch { /* A damaged value is rebuilt. */ }
    }
    await this.prefetchFiles(listed.map(entry => `${nb.root}/${entry.file}`));
    const templates: NoteTemplateInfo[] = [];
    // A registered template whose file is missing is described from the manifest alone; any other failed read is not kept, so the next call reads it again.
    let failed = false;
    for (const entry of listed) {
      templates.push(describeNoteTemplate(
        nb,
        entry,
        await this.readTemplate(nb, entry).catch((error: unknown) => {
          if (!(error instanceof SourceError && error.status === 404)) failed = true;
          return undefined;
        }),
      ));
    }
    const text = JSON.stringify(templates);
    if (this.cache && !failed && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    return templates;
  }

  /** The templates of one notebook, or of every notebook this repository serves, each with its placeholders. */
  async templates(notebookId?: string): Promise<NoteTemplateInfo[]> {
    const config = await this.config();
    if (notebookId && !config.notebooks.some(nb => nb.id === notebookId)) throw new SourceError('Notebook is not configured.', 404);
    const listed: NoteTemplateInfo[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) listed.push(...await this.notebookTemplates(nb));
    return listed;
  }

  /**
   * Those templates as `list_templates` answers them: each with its last use, which the notebook's notes index dates from
   * the notes stamped with the template's id. The answer is kept with the index's other derived results, so no note is read for it.
   */
  async listedTemplates(notebookId?: string): Promise<ListedNoteTemplate[]> {
    const config = await this.config();
    if (notebookId && !config.notebooks.some(nb => nb.id === notebookId)) throw new SourceError('Notebook is not configured.', 404);
    const catalog = this.catalog();
    const listed: ListedNoteTemplate[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const templates = await this.notebookTemplates(nb);
      if (!templates.length) continue;
      const used = await catalog.memo('template-use', [nb], async () => templateLastUse(await catalog.index(nb)));
      listed.push(...templates.map(template => ({ ...template, lastUsed: lastUseOf(used, template.id) })));
    }
    return listed;
  }

  /** One template of a notebook, a manifest-registered one or a `.templates/` file, with its frontmatter, body and the file's own text. */
  async template(notebookId: string, templateId: string) {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId);
    const entry = nb && (await this.templateEntries(nb)).find(candidate => candidate.id === templateId);
    if (!nb || !entry) throw new SourceError('Template is not configured for this notebook.', 404);
    return { notebook: nb, entry, ...await this.readTemplate(nb, entry) };
  }

  /**
   * Fills a template for a note titled `title`; `fill` carries the caller's date, time and placeholder values, the clock
   * serving the rest. With `defaults: false` a placeholder without a value stays as written, as the app's New note menu asks.
   */
  async renderTemplate(notebookId: string, templateId: string, title: string, fill: { date?: string; time?: string; values?: unknown; defaults?: boolean; } = {}): Promise<RenderedNoteTemplate> {
    const template = await this.template(notebookId, templateId);
    const now = new Date();
    try {
      return renderNoteTemplate(template, { title, date: fill.date || formatTemplateDate(now), time: fill.time || formatTemplateTime(now), values: templateValues(template, fill.values), defaults: fill.defaults });
    } catch (error) {
      throw new SourceError((error as Error).message);
    }
  }

  async notes(notebookId?: string): Promise<NoteItem[]> {
    return this.readMarkdownNotes(notebookId, false);
  }
  /** All native Markdown bodies, including outlines, for reference safety checks. */
  async markdownNotes(notebookId?: string): Promise<NoteItem[]> {
    return this.readMarkdownNotes(notebookId, true);
  }
  private async readMarkdownNotes(notebookId: string | undefined, includeOutlines: boolean): Promise<NoteItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    const output: NoteItem[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const { links, away, added } = await this.liveOverlay(nb);
      // Pending live notes are listed at their virtual paths after the notebook's Git notes, and notes moving elsewhere at their targets.
      const files = [...this.notebookFiles(nb, entries, includeOutlines).filter(file => NOTE_EXTENSIONS.test(file.path) && !away.has(file.path)).map(file => file.path), ...added.map(link => link.path)];
      await this.prefetchFiles(files);
      await this.loadLiveTexts(links.filter(link => files.includes(link.path)));
      // The shared transport coalesces cache misses and serializes upstream requests.
      for (let i = 0; i < files.length; i += 6) output.push(...await Promise.all(files.slice(i, i + 6).map(file => this.noteOf(file, false))));
    }
    return output;
  }

  async readNotes(files: string[], expected: string): Promise<NoteItem[]> {
    if (!Array.isArray(files) || !files.length || files.length > 200 || files.some(file => typeof file !== 'string' || file.length > 2048)) {
      throw new SourceError('Select between 1 and 200 note paths.');
    }
    const snapshot = await this.getSnapshot(true);
    if (!expected || snapshot.sha !== expected) throw new StaleRevisionError([this.id], 'The repository changed. Review the latest version before committing.');
    await this.prefetchFiles(files);
    const notes: NoteItem[] = [];
    for (const file of files) {
      try {
        notes.push(await this.note(file));
      } catch (error) {
        // A deleted selected note is absent from the result so the browser can preserve and mark its draft.
        if (!(error instanceof SourceError) || error.status !== 404 || snapshot.entries.some(entry => entry.path === file)) throw error;
      }
    }
    return notes;
  }

  async folders(): Promise<FolderItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    await this.prefetchFiles(entries.filter(entry => entry.path.endsWith('/_dir.yml') && config.notebooks.some(nb => entry.path.startsWith(nb.root + '/'))).map(entry => entry.path));
    const folders: FolderItem[] = [];
    for (const nb of config.notebooks) {
      const list: FolderItem[] = [];
      for (const entry of entries.filter(e => e.type === 'tree' && e.path.startsWith(`${nb.root}/`))) {
        const relative = entry.path.slice(nb.root.length + 1);
        if (!isNotebookContent(relative, nb)) continue;
        const file = `${entry.path}/_dir.yml`;
        const raw = entries.some(e => e.path === file && e.mode !== '120000') ? (await this.readFile(file)).toString('utf8') : '';
        list.push({ notebookId: nb.id, path: relative, ...parseFolderConfig(raw, path.posix.basename(relative), file) });
      }
      folders.push(...sortFolders(list));
    }
    return folders;
  }

  async assets(notebookId?: string) {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId) || config.notebooks[0];
    const prefix = assetRoot(nb) + '/';
    const snapshot = await this.getSnapshot();
    return snapshot.entries.filter(e => e.type === 'blob' && e.mode !== '120000' && isAssetPath(e.path, nb)).map(e => ({ ...assetInfo(e.path, prefix.slice(0, -1), e.sha, e.size || 0), revision: snapshot.sha }));
  }
}
