import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { createMCPServer } from './server.js';

/**
 * The stdio MCP server's command (`github-notes-mcp [repository]`). It starts when this file runs, so it lives apart
 * from the package entry: an edition that bundles the package into one file imports `index.ts` and never attaches a
 * server to its own stdin and stdout.
 */
async function main() {
  // The repository root is the first argument, else the working directory.
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const server = createMCPServer(repoRoot);
  await server.connect(new StdioServerTransport());
  // Stderr only, so the protocol on stdout stays clean.
  console.error(`[github-notes-mcp] Stdio server running for root: ${repoRoot}`);
}

main().catch((err) => {
  console.error('[github-notes-mcp] Fatal error:', err);
  process.exit(1);
});
