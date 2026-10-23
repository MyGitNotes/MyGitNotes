import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite's Lightning CSS minifier writes both forms from the standard property, but given both it keeps only the
 * `-webkit-` one, which Chrome ignores, so every glass surface lost its blur. Declare only `backdrop-filter`.
 */
describe('backdrop-filter declarations', () => {
  it('declare no -webkit-backdrop-filter beside the standard property', () => {
    const root = path.resolve('apps/web/src');
    const violations: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (file.endsWith('.css')) {
          fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
            // An `@supports (-webkit-backdrop-filter: …)` condition is a feature query, not a declaration.
            if (/(^|[;{\s])-webkit-backdrop-filter\s*:/.test(line)) violations.push(`${path.relative(root, file)}:${index + 1}`);
          });
        }
      }
    };
    scan(root);
    expect(violations).toEqual([]);
  });
});
