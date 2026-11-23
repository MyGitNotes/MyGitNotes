import { Request, Response, Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { classifyResource, deleteNoteFile, isTemplateFile, keyedItem, lookupNotes, NOTE_RESOURCE_TYPES, noteAgenda, type NoteEditFact, noteFacets, noteGraph, type NoteItem, parseNoteQuery, queryNotePaths, queryNotes, readNoteFile, type RepositoryCatalog, resolveSafePath, scanNotebookEntries, scanNotebookFolders, scanNotebookNotes, SourceError, StaleRevisionError, withEditDate, type WorkspaceConfig, writeNoteFile } from '@mygitnotes/core';
import { changeFile, generateCommitMessage, listChanges, noteEditFacts, stageAndCommit } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { asLocal, eachRepository, type LocalHandle, notebookRepository, noteRepository, requestCatalog } from './request-workspace.js';
import { moveLocalVersionFiles, restoreLocalVersionFile } from './version-files.js';
import { regularPath } from './workspace-files.js';
import { fail } from './route-errors.js';

/**
 * Refuses every path that is not a note, an outline, a compilation or a template: a text file, a PDF, a page, an image,
 * an asset, an agent's file and every path the manifest excludes. Such a file is read through the file routes; no note
 * route reads, writes, deletes or restores it, which is what a remote workspace answers too (`RemoteSource.note`, `save`).
 */
function assertNote(file: string, config: WorkspaceConfig): void {
  if (!NOTE_RESOURCE_TYPES.includes(classifyResource(file, config).type)) throw new SourceError('Path is not a configured note.', 403);
}

/** What Git tells of the edit dates of the notes under `notebooks` in the worktree at `root`, by repository-relative path. */
const editFacts = (root: string, notebooks: { root: string; }[]): Promise<Map<string, NoteEditFact>> => noteEditFacts(root, notebooks.map(notebook => notebook.root));

export function createLocalNotesRouter(): Router {
  const router = Router();

  /** Per-request read model over the working tree; local reads are not cached. */
  function localCatalog(repoRoot: string, scope: readonly string[]): RepositoryCatalog {
    const scans = new Map<string, NoteItem[]>();
    const scan = (notebook: Parameters<typeof scanNotebookEntries>[1]) => {
      let notes = scans.get(notebook.id);
      if (!notes) {
        notes = scanNotebookEntries(repoRoot, notebook, scope);
        scans.set(notebook.id, notes);
      }
      return notes;
    };
    return { revision: async () => '', index: async notebook => scan(notebook).map(({ content: _content, ...note }) => note), contents: async notes => new Map(notes.map(note => [note.path, scans.get(note.notebookId)?.find(item => item.path === note.path)?.content ?? ''])), memo: (_kind, _notebooks, compute) => compute(), folders: async notebook => scanNotebookFolders(repoRoot, notebook), template: async (notebook, file) => isTemplateFile(file.slice(notebook.root.length + 1), notebook) && fs.lstatSync(regularPath(repoRoot, file), { throwIfNoEntry: false })?.isFile() ? readNoteFile(repoRoot, file, notebook.id, scope) : undefined, dates: () => noteEditFacts(repoRoot, scope) };
  }

  const catalogOf = (res: Response) => requestCatalog(res, undefined, (handle, notebooks) => localCatalog((handle as LocalHandle).root, notebooks.map(notebook => notebook.root)));

  function queryError(res: Response, error: unknown) {
    res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : String(error), ...(error instanceof StaleRevisionError ? { staleRepositories: error.repositories } : {}) });
  }

  router.get('/query', async (req: Request, res: Response) => {
    try {
      const { query, options } = parseNoteQuery(req.query);
      const catalog = await catalogOf(res);
      res.json(options.select ? await queryNotePaths(catalog, query) : await queryNotes(catalog, query, options));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/facets', async (req: Request, res: Response) => {
    try {
      res.json(await noteFacets(await catalogOf(res), req.query.showHidden === '1'));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.post('/lookup', async (req: Request, res: Response) => {
    try {
      res.json(await lookupNotes(await catalogOf(res), req.body?.notes, req.body?.content === true));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/agenda', async (req: Request, res: Response) => {
    try {
      if (typeof req.query.notebookId !== 'string' || !req.query.notebookId) throw new SourceError('notebookId is required.');
      res.json(await noteAgenda(await catalogOf(res), req.query.notebookId, req.query.showHidden === '1'));
    } catch (error) {
      queryError(res, error);
    }
  });
  router.get('/graph', async (_req: Request, res: Response) => {
    try {
      res.json(await noteGraph(await catalogOf(res)));
    } catch (error) {
      queryError(res, error);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const notebookId = req.query.notebookId;
      const repositories = notebookId ? [await notebookRepository(res, notebookId)].map(({ handle, alias, notebook }) => ({ handle, alias, notebooks: [notebook] })) : (await eachRepository(res)).map(({ handle, alias, config }) => ({ handle, alias, notebooks: config.notebooks }));
      const listed = await Promise.all(repositories.map(async ({ handle, alias, notebooks }) => {
        const root = asLocal(handle).root, facts = await editFacts(root, notebooks);
        return notebooks.flatMap(notebook => scanNotebookNotes(root, notebook).map(note => keyedItem(alias)(withEditDate(note, facts.get(note.path)))));
      }));
      res.json({ notes: listed.flat() });
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Read single note
  router.get('/read', async (req: Request, res: Response) => {
    try {
      const relPath = req.query.path as string;
      if (!relPath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }
      const { handle, alias, notebook, config } = await noteRepository(res, relPath, req.query.notebookId);
      assertNote(relPath, config);
      const root = asLocal(handle).root;
      const note = readNoteFile(root, relPath, notebook.id, config.notebooks.map(item => item.root));
      res.json({ note: keyedItem(alias)(withEditDate(note, (await editFacts(root, config.notebooks)).get(note.path))) });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return res.status(404).json({ error: 'Note not found.' });
      res.status(err instanceof SourceError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Save note & create commit
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { path: notePath, content, metadata, commitMessage, notebookId } = req.body;
      if (!notePath || typeof content !== 'string') {
        return res.status(400).json({ error: 'path and content are required' });
      }
      const { handle, alias, notebook, config } = await noteRepository(res, notePath, notebookId);
      assertNote(notePath, config);
      const repoRoot = asLocal(handle).root;

      return await serializeWorkspaceMutation(repoRoot, async () => {
        if (req.body.createOnly && fs.existsSync(resolveSafePath(repoRoot, notePath))) return res.status(409).json({ error: 'A note already exists at this path.' });
        const saved = keyedItem(alias)(writeNoteFile(repoRoot, notePath, content, metadata, notebook.id, config.notebooks.map(item => item.root)));

        // If noCommit is requested or commit is false, write file and leave working tree dirty
        if (req.body.noCommit === true || req.body.commit === false) {
          return res.json({ success: true, note: saved, committed: false });
        }

        // Commit change
        let message = commitMessage;
        if (!message) {
          message = await generateCommitMessage({ filePath: notePath, diff: content });
        }

        const commit = await stageAndCommit(repoRoot, [notePath], message);
        res.json({ success: true, note: saved, commit, committed: true });
      });
    } catch (err: unknown) {
      fail(res, err);
    }
  });

  // Delete note & create commit (or leave uncommitted if noCommit is true)
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const notePath = req.query.path as string;
      const noCommit = req.query.noCommit === 'true' || req.body?.noCommit === true;
      if (!notePath) {
        return res.status(400).json({ error: 'path is required' });
      }
      const { handle, config } = await noteRepository(res, notePath, req.query.notebookId);
      assertNote(notePath, config);
      const repoRoot = asLocal(handle).root;

      return await serializeWorkspaceMutation(repoRoot, async () => {
        deleteNoteFile(repoRoot, notePath);
        // The note's versions go with it; restoring the note brings them back.
        const versionFiles = moveLocalVersionFiles(repoRoot, [notePath], file => file, file => file === notePath);
        if (noCommit) {
          // An untracked note leaves no change behind, so there is nothing to commit or list as deleted.
          const pending = (await listChanges(repoRoot)).some(file => file.path === notePath && file.kind === 'deleted');
          return res.json({ success: true, committed: false, pending });
        }

        const commit = await stageAndCommit(repoRoot, [notePath, ...versionFiles], `docs(notes): delete ${path.basename(notePath)}`);
        res.json({ success: true, commit, committed: true });
      });
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Restore note before commit
  router.post('/restore', async (req: Request, res: Response) => {
    try {
      const { path: notePath, content, metadata, notebookId } = req.body;
      if (!notePath) {
        return res.status(400).json({ error: 'path is required' });
      }
      const { handle, alias, notebook, config } = await noteRepository(res, notePath, notebookId);
      assertNote(notePath, config);
      const repoRoot = asLocal(handle).root;

      return await serializeWorkspaceMutation(repoRoot, async () => {
        if (typeof content === 'string') {
          const restored = keyedItem(alias)(writeNoteFile(repoRoot, notePath, content, metadata, notebook.id, config.notebooks.map(item => item.root)));
          await restoreLocalVersionFile(repoRoot, notePath);
          return res.json({ success: true, note: restored });
        }

        const change = (await listChanges(repoRoot)).find(file => file.path === notePath);
        if (!change) return res.status(409).json({ error: 'This note has no changes to restore.' });
        const restored = await changeFile(repoRoot, notePath, 'restore', req.body.revision || change.revision);
        await restoreLocalVersionFile(repoRoot, notePath);
        if (!change.tracked) return res.json({ success: true, note: null, ...restored });
        const restoredNote = keyedItem(alias)(readNoteFile(repoRoot, notePath, notebook.id, config.notebooks.map(item => item.root)));
        res.json({ success: true, note: restoredNote });
      });
    } catch (err: unknown) {
      fail(res, err);
    }
  });

  return router;
}
