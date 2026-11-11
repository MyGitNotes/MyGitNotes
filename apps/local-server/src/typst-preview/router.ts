import { classifyResource, SourceError } from '@mygitnotes/core';
import { type Response, Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { agentClientAllowed } from '../pi-agent.js';
import { asLocal, noteRepository } from '../request-workspace.js';
import { parseBibliography } from './bibtex.js';
import { bibliographyRevision, findPreviewProject, findToolkit, type PreviewProject } from './project.js';

const MAX_BIBLIOGRAPHY_BYTES = 64 * 1024 * 1024;

/** The worktree and thesis-toolkit project of the note a request names; the project is null for any other note. */
async function projectOf(res: Response, file: unknown, notebookId: unknown): Promise<{ root: string; project: PreviewProject | null; }> {
  const { handle, config } = await noteRepository(res, file, notebookId);
  const root = asLocal(handle).root;
  if (classifyResource(file as string, config).type !== 'note') return { root, project: null };
  return { root, project: findPreviewProject(root, file as string, reason => console.warn(reason)) };
}

function fail(res: Response, error: unknown): void {
  const status = error instanceof SourceError ? error.status : (error as { status?: number; })?.status;
  res.status(status ?? 500).json({ error: error instanceof Error ? error.message : String(error) });
}

/**
 * The Typst preview of a thesis-toolkit project (local mode only; mounted by `createLocalApp`, whose path check has
 * already run on `path`). These routes run code from the workspace's `node_modules`, so they answer whom the agent
 * panel answers: a page served from this machine, or its owner through `pnpm dev:remote`.
 */
export function createTypstPreviewRouter(): Router {
  const router = Router();
  router.use((req, res, next) => agentClientAllowed(req) ? next() : res.status(403).json({ error: 'The Typst preview is available only from this computer, or to its owner through pnpm dev:remote.' }));

  router.get('/project', async (req, res) => {
    try {
      const { root, project } = await projectOf(res, req.query.path, req.query.notebookId);
      if (!project) return res.json({ project: null });
      const toolkit = findToolkit(root, project.configDir);
      res.json({ project: { name: project.name, targets: project.targets, defaultTarget: project.defaultTarget, bibliographyRevision: bibliographyRevision(project.bibliography) }, toolkit: toolkit.ok ? { ok: true, version: toolkit.version } : toolkit });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/bibliography', async (req, res) => {
    try {
      const { root, project } = await projectOf(res, req.query.path, req.query.notebookId);
      if (!project) return res.status(404).json({ error: 'This note is not in a thesis-toolkit project.' });
      const shown = path.relative(root, project.bibliography);
      const stat = fs.statSync(project.bibliography, { throwIfNoEntry: false });
      if (!stat?.isFile()) return res.status(404).json({ error: `The bibliography ${shown} does not exist.` });
      if (stat.size > MAX_BIBLIOGRAPHY_BYTES) return res.status(413).json({ error: `The bibliography ${shown} is too large to list.` });
      res.json({ revision: bibliographyRevision(project.bibliography), entries: parseBibliography(fs.readFileSync(project.bibliography, 'utf8')) });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
