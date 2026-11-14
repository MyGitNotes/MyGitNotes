import { Request, Response, Router } from 'express';
import { formatTemplateDate, formatTemplateTime, keyedItem, listNoteTemplates, loadNoteTemplate, renderNoteTemplate, scanNotebookFolders, SourceError } from '@mygitnotes/core';
import { asLocal, eachRepository, notebookRepository } from './request-workspace.js';

export function createLocalFoldersTemplatesRouter(): Router {
  const router = Router();

  router.get('/api/folders', async (_req, res) => {
    try {
      res.json({ folders: (await eachRepository(res)).flatMap(({ handle, alias, config }) => config.notebooks.flatMap(nb => scanNotebookFolders(asLocal(handle).root, nb).map(keyedItem(alias)))) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/api/templates', async (req: Request, res: Response) => {
    try {
      const { handle, alias, notebook } = await notebookRepository(res, req.query.notebookId);
      res.json({ templates: listNoteTemplates(asLocal(handle).root, notebook).map(keyedItem(alias)) });
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/api/templates/render', async (req: Request, res: Response) => {
    try {
      const notebookId = req.query.notebookId as string;
      const templateId = req.query.templateId as string;
      const title = (req.query.title as string) || '';
      const { handle, notebook } = await notebookRepository(res, notebookId);
      const template = loadNoteTemplate(asLocal(handle).root, notebook, templateId);
      // The page sends its reader's own date and time; a caller that sends none gets the server's clock.
      const now = new Date();
      const rendered = renderNoteTemplate(template, { title, date: typeof req.query.date === 'string' && req.query.date ? req.query.date : formatTemplateDate(now), time: typeof req.query.time === 'string' && req.query.time ? req.query.time : formatTemplateTime(now) });
      res.json(rendered);
    } catch (err: unknown) {
      res.status(err instanceof SourceError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
