import { describe, expect, it } from 'vitest';
import { type EditionSourceConfig, parseSourceConfig, sourceIdentity } from '../src/source-config.js';
import { sameSite } from '../src/workspace-config-source.js';
import { createRemoteSource } from '../src/remote-factory.js';
import { repositoryRef, sharesCredential } from '../src/repository.js';

const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };

describe('edition sources', () => {
  it('spells the identity from the platform, repository and branch, not the label', () => {
    expect(sourceIdentity(edition)).toBe('edition:hosted:p1/notes@main');
    expect(sourceIdentity({ ...edition, label: 'Other' })).toBe('edition:hosted:p1/notes@main');
    expect(repositoryRef(edition).id).toBe('edition:hosted:p1/notes@main');
  });

  it('is on every non-local site and never on a local one', () => {
    expect(sameSite({ type: 'github' }, edition)).toBe(true);
    expect(sameSite({ type: 'github', url: 'https://ghe.example.com' }, edition)).toBe(true);
    expect(sameSite({ type: 'gitlab', url: 'https://gitlab.example.com' }, edition)).toBe(true);
    expect(sameSite({ type: 'local' }, edition)).toBe(false);
  });

  it('shares no credential with a provider repository', () => {
    expect(sharesCredential({ type: 'github', repository: 'a/b', branch: 'main' }, edition)).toBe(false);
  });

  it('cannot be named by a server file', () => {
    expect(() => parseSourceConfig({ source: { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' } }, '/')).toThrow();
  });

  it('is not opened outside the server that composes it', () => {
    expect(() =>
      createRemoteSource(edition, undefined, fetch, undefined, async () => {
        throw new Error('unused');
      })
    ).toThrow(/Edition platform hosted/);
  });
});
