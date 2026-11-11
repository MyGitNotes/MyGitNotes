import { classifyResource, SourceError } from '@mygitnotes/core';
import { type Response, Router } from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { agentClientAllowed } from '../pi-agent.js';
import { asLocal, noteRepository } from '../request-workspace.js';
import { parseBibliography } from './bibtex.js';
import { PreviewCompiler } from './compiler.js';
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

/** Names one project and target of one configuration file; a run and its PDF are kept under it. */
const jobKey = (project: PreviewProject, target: string) => createHash('sha256').update(`${project.configFile}\0${project.name}\0${target}`).digest('hex');
const queueKey = (project: PreviewProject) => createHash('sha256').update(`${project.configFile}\0${project.name}`).digest('hex');

/** The target a request names when the project, as just read from disk, has it. */
const knownTarget = (project: PreviewProject, target: unknown): string | undefined => typeof target === 'string' && project.targets.includes(target) ? target : undefined;

const SETUP_MESSAGES = { missing: 'thesis-toolkit is not installed in this workspace.', 'too-old': 'The installed thesis-toolkit is too old for the preview.', 'unsupported-platform': 'thesis-toolkit runs on macOS and Linux only.' } as const;

/**
 * The Typst preview of a thesis-toolkit project (local mode only; mounted by `createLocalApp`, whose path check has
 * already run on `path`). These routes run code from the workspace's `node_modules`, so they answer whom the agent
 * panel answers: a page served from this machine, or its owner through `pnpm dev:remote`.
 */
export function createTypstPreviewRouter(compiler = new PreviewCompiler()): Router {
  const router = Router();
  router.use((req, res, next) => agentClientAllowed(req) ? next() : res.status(403).json({ error: 'The Typst preview is available only from this computer, or to its owner through pnpm dev:remote.' }));

  router.get('/project', async (req, res) => {
    try {
      const { root, project } = await projectOf(res, req.query.path, req.query.notebookId);
      if (!project) return res.json({ project: null });
      const toolkit = findToolkit(root, project.configDir);
      res.json({ // `directory` lets the page tell which saved notes belong to the project, without asking about each.
        project: { name: project.name, directory: path.relative(fs.realpathSync(root), project.projectDir).split(path.sep).join('/'), targets: project.targets, defaultTarget: project.defaultTarget, bibliographyRevision: bibliographyRevision(project.bibliography) },
        toolkit: toolkit.ok ? { ok: true, version: toolkit.version } : toolkit,
      });
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

  // Runs the installed toolkit on the saved files and answers when that run, or the one run queued behind it, ends.
  router.post('/compile', async (req, res) => {
    try {
      const { root, project } = await projectOf(res, req.body?.path, req.body?.notebookId);
      if (!project) return res.status(404).json({ error: 'This note is not in a thesis-toolkit project.' });
      const target = knownTarget(project, req.body?.target);
      if (!target) return res.status(400).json({ error: 'target must be one of the targets of the project.' });
      const toolkit = findToolkit(root, project.configDir);
      if (!toolkit.ok) return res.status(409).json({ error: SETUP_MESSAGES[toolkit.code], code: toolkit.code });
      res.json(await compiler.compile({ key: jobKey(project, target), queue: queueKey(project), cli: toolkit.cli, cwd: project.configDir, project: project.name, target }));
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/pdf', async (req, res) => {
    try {
      const { project } = await projectOf(res, req.query.path, req.query.notebookId);
      const target = project && knownTarget(project, req.query.target);
      const pdf = project && target ? compiler.pdf(jobKey(project, target)) : undefined;
      if (!pdf) return res.status(404).json({ error: 'No PDF has been compiled for this project and target.' });
      if (req.query.revision !== undefined && req.query.revision !== pdf.revision) return res.status(409).json({ error: 'A newer PDF has been compiled.', revision: pdf.revision });
      // Read in one step with the check above, so the bytes are the revision that was checked.
      const bytes = fs.readFileSync(pdf.file);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(bytes);
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
