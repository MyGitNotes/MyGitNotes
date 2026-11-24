import { configDefaults, defineConfig } from 'vitest/config';

// Vitest empties imported CSS by default; print export tests need the actual inlined KaTeX and infographic styles.
// Vitest 4 stopped excluding dist by default; the tsc output beside the sources would run each test twice.
// Vitest 3 started failing a test that blocks on a child process for longer than the timeout; the bootstrap and sparse-path
// tests spawn tsx and git synchronously and take well over 5 s on a busy machine.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '**/dist/**'], testTimeout: 60_000, css: { include: [/[\\/]katex[\\/]/, /[\\/]directives[\\/]infographics[\\/](?:process|decision|nested)\.css/] } } });
