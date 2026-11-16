import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { RepositoryStatus } from '@mygitnotes/core/repository';
import { NoteInfoPanel } from './NoteInfoPanel.js';
import { NoteLocationProvider, noteLocation } from '../../lib/note-location.js';
import { type WebFeature, WebFeaturesProvider } from '../../lib/web-features.js';

type Repository = Pick<RepositoryStatus, 'id' | 'type' | 'repository' | 'branch' | 'write' | 'demo' | 'unavailable'>;

const note = { notebookId: 'life', path: 'notes/life/a.md' };
const pages: WebFeature = { id: 'pages', publish: ({ repository }) => createElement('div', null, createElement('dt', null, 'Public page'), createElement('dd', null, repository)) };
const panel = (repository: Repository) =>
  renderToStaticMarkup(
    <WebFeaturesProvider features={[pages]}>
      <NoteLocationProvider locate={() => noteLocation('Life', repository, note.path)}>
        <NoteInfoPanel note={note} content='Body' metadata={{}} setMetadata={() => {}} locked={false} />
      </NoteLocationProvider>
    </WebFeaturesProvider>,
  );
const rows = (html: string) => ({ gist: html.includes('<dt>Gist</dt>'), publish: html.includes('<dt>Public page</dt>') });

it("shows an edition's publish rows for every writable note whatever its repository, and the Gist row only for GitHub", () => {
  expect(rows(panel({ id: 'github:me/notes@main', type: 'github', repository: 'me/notes', branch: 'main', write: true }))).toEqual({ gist: true, publish: true });
  expect(rows(panel({ id: 'hosted:n1', type: 'edition', repository: 'n1', branch: 'main', write: true }))).toEqual({ gist: false, publish: true });
  expect(rows(panel({ id: 'gitlab:me/notes@main', type: 'gitlab', repository: 'me/notes', branch: 'main', write: true }))).toEqual({ gist: false, publish: true });
  expect(panel({ id: 'hosted:n1', type: 'edition', repository: 'n1', branch: 'main', write: true })).toContain('<dt>Public page</dt><dd>n1</dd>');
});

it('shows neither row for a read-only or demo note', () => {
  expect(rows(panel({ id: 'github:me/notes@main', type: 'github', repository: 'me/notes', branch: 'main', write: false }))).toEqual({ gist: false, publish: false });
  expect(rows(panel({ id: 'hosted:n1', type: 'edition', repository: 'n1', branch: 'main', write: false }))).toEqual({ gist: false, publish: false });
  expect(rows(panel({ id: 'github:me/demo@main', type: 'github', repository: 'me/demo', branch: 'main', write: false, demo: true }))).toEqual({ gist: false, publish: false });
  expect(rows(panel({ id: 'hosted:n1', type: 'edition', repository: 'n1', branch: 'main', write: true, unavailable: { reason: 'unmapped', message: 'Not found' } }))).toEqual({ gist: false, publish: false });
});
