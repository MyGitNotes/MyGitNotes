import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The thesis-toolkit configuration file; the nearest one at or above a note names its project. */
export const TOOLKIT_CONFIG = 'thesis-toolkit.json';
/** The first toolkit release with `compile --output` and front matter stripping, which the preview needs. */
export const MINIMUM_TOOLKIT = '0.1.6';
const CONFIG_KEYS = ['root', 'projectsDir', 'bibliography'] as const;
const MAX_CONFIG_BYTES = 64 * 1024;

/** A thesis-toolkit project a note belongs to. Every path is absolute and resolves inside the worktree. */
export interface PreviewProject {
  name: string;
  /** The directories of `<project>/src/` that hold a `main.typ`, sorted. */
  targets: string[];
  defaultTarget: string;
  configFile: string;
  /** Where the toolkit runs: the directory of its configuration file. */
  configDir: string;
  projectDir: string;
  bibliography: string;
}

export type ToolkitStatus = { ok: true; version: string; cli: string; } | { ok: false; code: 'missing' | 'too-old' | 'unsupported-platform'; version?: string; };

const inside = (parent: string, child: string) => child === parent || child.startsWith(`${parent}${path.sep}`);

/**
 * `target` when it lies inside the worktree by name and by what it resolves to. A path that does not exist yet is
 * judged by its nearest existing ancestor, so a missing bibliography is still told apart from one outside.
 */
function contained(rootReal: string, target: string): boolean {
  let existing = target;
  for (;;) {
    try {
      return inside(rootReal, fs.realpathSync(existing));
    } catch {
      const parent = path.dirname(existing);
      // A dangling symlink has a name but no target; its target is unknown, so it is refused.
      if (parent === existing || fs.lstatSync(existing, { throwIfNoEntry: false })) return false;
      existing = parent;
    }
  }
}

function readConfig(file: string): Record<typeof CONFIG_KEYS[number], string> | undefined {
  let raw: unknown;
  try {
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) return undefined;
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  // The toolkit's own schema (`loadConfig`): these three paths and nothing else, so no key can name a command.
  if (Object.keys(record).some(key => !(CONFIG_KEYS as readonly string[]).includes(key))) return undefined;
  if (CONFIG_KEYS.some(key => typeof record[key] !== 'string' || record[key] === '')) return undefined;
  const base = path.dirname(file);
  return { root: path.resolve(base, record.root as string), projectsDir: path.resolve(base, record.projectsDir as string), bibliography: path.resolve(base, record.bibliography as string) };
}

/** A name the toolkit's `compile` takes as a project or target: an entry just read from disk that it cannot read as a flag. */
const plainName = (name: string) => name !== '' && !name.startsWith('-') && !name.startsWith('.');

function directories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && plainName(entry.name)).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

/** The nearest `thesis-toolkit.json` at or above `start`, no higher than the worktree root. */
function findConfigFile(rootReal: string, start: string): string | undefined {
  for (let dir = start; inside(rootReal, dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, TOOLKIT_CONFIG);
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    if (dir === rootReal) break;
  }
  return undefined;
}

/**
 * The thesis-toolkit project of the note at `noteRelPath` (already checked to be a note of a notebook), or null:
 * no configuration at or above it inside the worktree, a note outside `<projectsDir>/<project>/`, a project or
 * configuration path that leaves the worktree, or no target to compile. `log` hears why a found configuration was refused.
 */
export function findPreviewProject(worktreeRoot: string, noteRelPath: string, log: (reason: string) => void = () => {}): PreviewProject | null {
  const rootReal = fs.realpathSync(worktreeRoot);
  let noteDir: string;
  try {
    noteDir = fs.realpathSync(path.dirname(path.resolve(rootReal, noteRelPath)));
  } catch {
    return null;
  }
  if (!inside(rootReal, noteDir)) return null;
  const configFile = findConfigFile(rootReal, noteDir);
  if (!configFile) return null;
  const refuse = (reason: string) => {
    log(`[typst-preview] ${path.relative(rootReal, configFile) || TOOLKIT_CONFIG}: ${reason}`);
    return null;
  };
  if (!contained(rootReal, configFile)) return refuse('the configuration file resolves outside the worktree');
  const config = readConfig(configFile);
  if (!config) return refuse('not a thesis-toolkit configuration (root, projectsDir, bibliography)');
  for (const key of CONFIG_KEYS) {
    if (!inside(rootReal, config[key]) || !contained(rootReal, config[key])) return refuse(`"${key}" resolves outside the worktree`);
  }
  let projectsReal: string;
  try {
    projectsReal = fs.realpathSync(config.projectsDir);
  } catch {
    return refuse('"projectsDir" does not exist');
  }
  if (!inside(projectsReal, noteDir) || noteDir === projectsReal) return null;
  const name = path.relative(projectsReal, noteDir).split(path.sep)[0]!;
  // The name must be an entry the directory really lists (not another spelling of it) that `compile` cannot read as a flag.
  if (!directories(projectsReal).includes(name)) return refuse(`project "${name}" is not a plain directory name`);
  const projectDir = path.join(projectsReal, name);
  if (!contained(rootReal, projectDir) || !contained(rootReal, path.join(projectDir, 'src'))) return refuse(`project "${name}" resolves outside the worktree`);
  const targets = directories(path.join(projectDir, 'src')).filter(target => {
    const main = path.join(projectDir, 'src', target, 'main.typ');
    return fs.statSync(main, { throwIfNoEntry: false })?.isFile() && contained(rootReal, main);
  });
  if (!targets.length) return null;
  return { name, targets, defaultTarget: targets.includes('main') ? 'main' : targets[0]!, configFile, configDir: path.dirname(configFile), projectDir, bibliography: config.bibliography };
}

/** A hash of the bibliography's modification time and size, so a reader knows when to read it again; `missing` without the file. */
export function bibliographyRevision(file: string): string {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return 'missing';
  return createHash('sha256').update(`${stat.mtimeMs}:${stat.size}`).digest('hex').slice(0, 16);
}

function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (value: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(value)?.slice(1).map(Number);
  const have = parts(version), want = parts(minimum)!;
  if (!have) return false;
  for (let i = 0; i < 3; i += 1) if (have[i] !== want[i]) return have[i]! > want[i]!;
  return true;
}

/**
 * The thesis-toolkit installed for a project: the first `node_modules/thesis-toolkit` at or above the configuration,
 * no higher than the worktree root. Nothing is looked up on PATH and nothing is downloaded.
 */
export function findToolkit(worktreeRoot: string, configDir: string, platform: NodeJS.Platform = process.platform): ToolkitStatus {
  if (platform === 'win32') return { ok: false, code: 'unsupported-platform' };
  const rootReal = fs.realpathSync(worktreeRoot);
  for (let dir = configDir; inside(rootReal, dir); dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', 'thesis-toolkit');
    const manifest = path.join(packageDir, 'package.json');
    if (fs.statSync(manifest, { throwIfNoEntry: false })?.isFile()) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: unknown; bin?: unknown; };
        const version = typeof pkg.version === 'string' ? pkg.version : '';
        const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin as Record<string, unknown> | undefined)?.['thesis-toolkit'];
        if (typeof bin !== 'string' || !bin) return { ok: false, code: 'missing' };
        // The package may be a link to a checkout; its `bin` must still be a file of that package.
        const packageReal = fs.realpathSync(packageDir);
        const cli = fs.realpathSync(path.resolve(packageReal, bin));
        if (!inside(packageReal, cli) || !fs.statSync(cli).isFile()) return { ok: false, code: 'missing' };
        return versionAtLeast(version, MINIMUM_TOOLKIT) ? { ok: true, version, cli } : { ok: false, code: 'too-old', version };
      } catch {
        return { ok: false, code: 'missing' };
      }
    }
    if (dir === rootReal) break;
  }
  return { ok: false, code: 'missing' };
}
