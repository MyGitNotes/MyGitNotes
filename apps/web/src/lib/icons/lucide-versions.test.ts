import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it('installs lucide and lucide-react at the same version, so the icon data matches the toolbar glyphs', () => {
  expect(require('lucide/package.json').version).toBe(require('lucide-react/package.json').version);
});
