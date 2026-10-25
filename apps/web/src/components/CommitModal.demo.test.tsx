// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { DemoProvider } from '../lib/demo.js';
import { CommitModal } from './CommitModal.js';
import type { FileChange } from '../lib/types.js';
vi.mock('../lib/api.js', () => ({ commitStagedChanges: vi.fn(), fetchFileChanges: vi.fn(), fetchFileDiff: vi.fn(), generateSemanticCommit: vi.fn(), manageFileChange: vi.fn() }));
// jsdom ships no dialog implementation, so the modal shell needs one before it can mount.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function() {
    this.open = false;
  };
});
afterEach(cleanup);

const file: FileChange = { path: 'notes/a.md', staged: false, unstaged: true, kind: 'modified', tracked: true, revision: 'a', available: true };

function mount(demo: boolean) {
  return render(
    <I18nProvider>
      <DemoProvider value={demo ? { scenario: 'contract' } : null}>
        <CommitModal isOpen writable gitStatus={null} remoteChanges={[file]} getPreview={() => ''} describeChanges={() => ({ notes: [], documents: [] })} restoreFile={vi.fn()} commitFiles={vi.fn()} onChanged={async () => {}} onCommitted={async () => {}} onClose={() => {}} />
      </DemoProvider>
    </I18nProvider>,
  );
}

describe('The changes dialog hint', () => {
  it('says a demo commit stays in this browser instead of naming a remote commit', () => {
    mount(true);
    expect(screen.getByText(/stays in your browser/)).toBeTruthy();
    expect(screen.queryByText(/one remote commit/)).toBeNull();
  });

  it('still names the remote commit outside the demo', () => {
    mount(false);
    expect(screen.getByText(/one remote commit/)).toBeTruthy();
  });
});
