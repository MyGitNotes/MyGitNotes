import { beforeEach, describe, expect, it, vi } from 'vitest';

const syncGitWorkspace = vi.fn();
vi.mock('../lib/api.js', () => ({ syncGitWorkspace: (...args: unknown[]) => syncGitWorkspace(...args) }));
const { pullLatest } = await import('./pullLatest.js');

function params(patch: Partial<Parameters<typeof pullLatest>[0]> = {}) {
  const order: string[] = [];
  return { order, remote: false, upstream: true, refreshWorkspace: vi.fn(async (fresh?: boolean) => void order.push(fresh ? 'workspace:fresh' : 'workspace')), invalidateNotes: vi.fn(() => void order.push('notes')), refreshDocuments: vi.fn(async () => void order.push('documents')), onError: vi.fn(), ...patch };
}

beforeEach(() => {
  syncGitWorkspace.mockReset();
  syncGitWorkspace.mockImplementation(async () => ({ upstream: 'origin/main', pulled: 2, pushed: 0 }));
});

describe("a phone's pull on the list", () => {
  it("reads a hosted workspace's branch heads afresh and refetches its notes, pulling nothing on the server", async () => {
    const p = params({ remote: true });
    await pullLatest(p);
    expect(syncGitWorkspace).not.toHaveBeenCalled();
    expect(p.order).toEqual(['workspace:fresh', 'notes', 'documents']);
  });

  it("pulls a local workspace's main from its upstream without pushing, as 只拉取 does, then reloads", async () => {
    const p = params();
    await pullLatest(p);
    expect(syncGitWorkspace).toHaveBeenCalledWith(undefined, undefined, true);
    expect(p.order).toEqual(['workspace', 'notes', 'documents']);
  });

  it('only reloads a local workspace with no upstream', async () => {
    const p = params({ upstream: false });
    await pullLatest(p);
    expect(syncGitWorkspace).not.toHaveBeenCalled();
    expect(p.order).toEqual(['workspace', 'notes', 'documents']);
  });

  it('reports a failed pull and still reloads', async () => {
    syncGitWorkspace.mockRejectedValue(new Error('Pull failed: conflict'));
    const p = params();
    await pullLatest(p);
    expect(p.onError).toHaveBeenCalledWith('Pull failed: conflict');
    expect(p.order).toEqual(['workspace', 'notes', 'documents']);
  });
});
