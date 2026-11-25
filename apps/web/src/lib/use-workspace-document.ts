import { useCallback, useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import type { WorkspaceDocument } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from './i18n/index.js';
import { createUnifiedDiff } from './unified-diff.js';
import { notebookIdCodec } from './notebook-keys.js';
import { demoScopeOfRepository, noteDemoWriteIn, storageOwner } from './demo-storage.js';
import { committedDocuments, readLocalCommits } from './local-commits.js';

/** How the browser reaches one workspace document and names its failures. */
export interface WorkspaceDocumentClient<T> {
  document: Pick<WorkspaceDocument<T>, 'file' | 'schema' | 'empty' | 'read' | 'mapNotebookIds'>;
  endpoint: string;
  /** Local storage key prefix for the device draft, scoped by repository. */
  draftKey: string;
  messages: Record<'load' | 'conflict' | 'limit' | 'draft' | 'save' | 'loading', TranslationKey>;
  /**
   * Set for a document that, in an online workspace, is how this device arranges notes rather than repository content:
   * it is kept in this browser under this key prefix, scoped by repository, never listed in Changes nor committed, and
   * the repository's committed file is where it starts while the device keeps none. A local workspace still saves it.
   */
  deviceKey?: string;
  /**
   * This device's copy with the changes a draft of an earlier version made from its `base`, or undefined when the two
   * changed the same thing differently: a device document's draft is adopted only so, never written over the copy.
   */
  mergeDevice?(device: T, draft: T, base: T): T | undefined;
}
interface Snapshot<T> {
  page: T;
  revision: string;
  writable: boolean;
  path: string;
}
export interface WorkspaceDocumentDraft<T> {
  page: T;
  base: T;
  revision: string;
  legacy?: boolean;
  id?: string;
  ancestors?: string[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The repository a document draft belongs to: its id names the draft's storage key, its alias names its notebooks by key. */
export interface DocumentRepository {
  id: string;
  alias: string;
  /** A demo repository: its documents are edited and committed in this browser. */
  demo?: boolean;
}

/** Where one repository's draft of a document is stored; for the repository a workspace had before documents moved per repository, this is the key its drafts already used. */
export const documentDraftKey = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => `github-notes:${client.draftKey}:${storageOwner(repository)}`;

/**
 * A stored draft, its notebooks named by key; drafts saved before a format change migrate the same way as the stored
 * file. The draft keeps the repository's local notebook ids in storage, as the file does.
 */
export function readDocumentDraft<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository, fallbackBase: T): WorkspaceDocumentDraft<T> | undefined {
  const raw = localStorage.getItem(documentDraftKey(client, repository.id));
  if (!raw) return;
  const value = JSON.parse(raw);
  const { toKey } = notebookIdCodec(repository.alias);
  const keyed = (stored: unknown) => client.document.mapNotebookIds(client.document.read(stored), toKey);
  return { page: keyed(value.page), base: value.base ? keyed(value.base) : fallbackBase, revision: String(value.revision), legacy: !value.base, id: typeof value.id === 'string' ? value.id : undefined, ancestors: Array.isArray(value.ancestors) && value.ancestors.every((id: unknown) => typeof id === 'string') ? value.ancestors : [] };
}

/** Stores a draft whose notebooks are named by key with the repository's local ids. */
function writeDocumentDraft<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository, draft: WorkspaceDocumentDraft<T>) {
  const { toLocal } = notebookIdCodec(repository.alias);
  const stored = (page: T) => client.document.mapNotebookIds(page, toLocal);
  if (!noteDemoWriteIn(repository.id)) return;
  localStorage.setItem(documentDraftKey(client, repository.id), JSON.stringify({ ...draft, page: stored(draft.page), base: stored(draft.base) }));
}

/** Where this device keeps its own copy of a device document of one repository (`deviceKey`). */
export const deviceDocumentKey = (client: Pick<WorkspaceDocumentClient<unknown>, 'deviceKey'>, repository: string) => `github-notes:${client.deviceKey}:${storageOwner(repository)}`;

/** This device's copy of a device document, its notebooks named by key; undefined while the device keeps none. */
function readDeviceDocument<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository): T | undefined {
  const raw = localStorage.getItem(deviceDocumentKey(client, repository.id));
  if (!raw) return;
  const { toKey } = notebookIdCodec(repository.alias);
  return client.document.mapNotebookIds(client.document.read(JSON.parse(raw).page), toKey);
}

/** Stores this device's copy of a device document with the repository's local notebook ids; false when a demo refuses the write. */
function writeDeviceDocument<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository, page: T): boolean {
  if (!noteDemoWriteIn(repository.id)) return false;
  const { toLocal } = notebookIdCodec(repository.alias);
  localStorage.setItem(deviceDocumentKey(client, repository.id), JSON.stringify({ page: client.document.mapNotebookIds(page, toLocal) }));
  return true;
}

/**
 * Turns the drafts of device documents an earlier version left waiting in Changes into this device's copies, so they
 * leave Changes. While the device keeps no copy, the draft becomes it; a copy that differs takes the draft's changes
 * only where `mergeDevice` finds none of its own in their way (a tab of the earlier version still open writes such
 * drafts from what it read before). A draft that cannot be read or merged, or one beside a copy that cannot be read,
 * stays where it is, for Settings to discard with the repository's other drafts.
 */
export function adoptDeviceDrafts(clients: WorkspaceDocumentClient<unknown>[], repositories: DocumentRepository[]): void {
  for (const client of clients) {
    if (!client.deviceKey) continue;
    for (const repository of repositories) {
      let draft, kept;
      try {
        draft = readDocumentDraft(client, repository, client.document.empty());
      } catch {
        continue;
      }
      if (!draft) continue;
      try {
        kept = readDeviceDocument(client, repository);
      } catch {
        continue;
      }
      const next = kept === undefined ? draft.page : same(kept, draft.page) ? kept : client.mergeDevice?.(kept, draft.page, draft.base);
      if (next === undefined) continue;
      if (next === kept || writeDeviceDocument(client, repository, next)) localStorage.removeItem(documentDraftKey(client, repository.id));
    }
  }
}

/** A document draft of one repository, waiting in Changes for a remote commit. */
export interface PendingDocument {
  repository: string;
  file: string;
  page: unknown;
  base: unknown;
  diff: string;
  /** Set when the stored draft cannot be read; such a draft can only be discarded. */
  error?: string;
}
const documentDiff = (file: string, base: unknown, page: unknown) => createUnifiedDiff(file, file, stringify(base), stringify(page));

/** Every stored document draft of the given repositories, whichever notebook is open. */
export function pendingDocumentDrafts(clients: WorkspaceDocumentClient<unknown>[], repositories: DocumentRepository[]): PendingDocument[] {
  return repositories.flatMap(repository =>
    clients.flatMap(client => {
      let draft;
      try {
        draft = readDocumentDraft(client, repository, client.document.empty());
      } catch (error) {
        return [{ repository: repository.id, file: client.document.file, page: undefined, base: undefined, diff: '', error: (error as Error).message }];
      }
      return draft ? [{ repository: repository.id, file: client.document.file, page: draft.page, base: draft.base, diff: documentDiff(client.document.file, draft.base, draft.page) }] : [];
    })
  );
}

/** Discards one repository's draft of a document. */
export const discardDocumentDraft = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => localStorage.removeItem(documentDraftKey(client, repository));

/** Settles a committed draft: clears it, or keeps later edits on top of the committed page. */
export function settleDocumentDraft(client: WorkspaceDocumentClient<unknown>, repository: DocumentRepository, sent: { page: unknown; base?: unknown; id?: string; }, revision: string): boolean {
  const latest = readDocumentDraft(client, repository, sent.page);
  if (!latest) return true;
  const identical = same(latest.page, sent.page) && same(latest.base, sent.base);
  const descends = Boolean(sent.id && (latest.id === sent.id || latest.ancestors?.includes(sent.id)));
  if (!identical && !descends) return false;
  if (same(latest.page, sent.page)) localStorage.removeItem(documentDraftKey(client, repository.id));
  else writeDocumentDraft(client, repository, { ...latest, base: sent.page, revision });
  return true;
}

/**
 * Device draft, autosave on local main, and commit handoff for one workspace document of `repository`,
 * the repository of the open notebook.
 */
export function useWorkspaceDocument<T>(client: WorkspaceDocumentClient<T>, owner: DocumentRepository | undefined, onSaved: () => void, remote = false, enabled = true) {
  const { t } = useTranslation();
  const repository = owner?.id, alias = owner?.alias ?? '', demo = owner?.demo === true;
  const { document, endpoint, messages } = client;
  const [page, setPage] = useState<T>(document.empty);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const revision = useRef(''), base = useRef<T>(document.empty()), current = useRef(page);
  const loadRequest = useRef(0), draftIdentity = useRef<string>();
  const [snapshotKey, setSnapshotKey] = useState('');
  const saved = useRef(onSaved);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  saved.current = onSaved;
  /* eslint-enable react/refs */
  const key = documentDraftKey(client, repository ?? '');
  // Online, a device document is this device's own copy: no draft, nothing to commit (`deviceKey`).
  const device = remote && client.deviceKey ? deviceDocumentKey(client, repository ?? '') : undefined;
  const target = repository ? `${endpoint}?repository=${encodeURIComponent(repository)}` : endpoint;
  const currentKey = useRef(key);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  currentKey.current = key;
  /* eslint-enable react/refs */
  const readDraft = useCallback((): WorkspaceDocumentDraft<T> | undefined => readDocumentDraft(client, { id: repository ?? '', alias }, base.current), [client, repository, alias]);
  const load = useCallback(async (discard = false) => {
    const request = ++loadRequest.current;
    if (!enabled || !repository) {
      setSnapshot(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSaving(false);
    setError('');
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error(t(messages.load));
      const record: Snapshot<T> = await response.json();
      record.page = document.schema.parse(record.page);
      if (demo) {
        // Demo: the server's page is read-only, but this browser may change it and commit the change locally.
        const scope = demoScopeOfRepository(repository);
        const committed = scope ? committedDocuments(readLocalCommits(scope.scope))[record.path || document.file] : undefined;
        if (committed !== undefined) record.page = document.schema.parse(committed);
        record.writable = true;
      }
      if (currentKey.current !== key || request !== loadRequest.current) return;
      if (device) {
        const owned = { id: repository, alias };
        // Reloading drops a copy that cannot be read, and the device starts again from the committed file, or a draft.
        if (discard) {
          try {
            readDeviceDocument(client, owned);
          } catch {
            localStorage.removeItem(device);
          }
        }
        adoptDeviceDrafts([client as WorkspaceDocumentClient<unknown>], [owned]);
        const kept = readDeviceDocument(client, owned);
        base.current = record.page;
        current.current = kept ?? record.page;
        draftIdentity.current = undefined;
        revision.current = record.revision;
        setSnapshotKey(key);
        setSnapshot(record);
        setPage(current.current);
        setDirty(false);
        return;
      }
      if (discard) localStorage.removeItem(key);
      base.current = record.page;
      const draft = readDraft();
      base.current = draft?.base || record.page;
      current.current = draft?.page || record.page;
      draftIdentity.current = draft?.id;
      setSnapshotKey(key);
      setSnapshot(record);
      setPage(current.current);
      revision.current = draft?.revision || record.revision;
      setDirty(Boolean(draft));
      if (draft && (remote && !draft.legacy ? !same(draft.base, record.page) : draft.revision !== record.revision)) setError(t(messages.conflict));
    } catch (error) {
      if (currentKey.current === key && request === loadRequest.current) {
        setSnapshot(undefined);
        setError((error as Error).message);
      }
    } finally {
      if (currentKey.current === key && request === loadRequest.current) setLoading(false);
    }
  }, [key, device, client, alias, enabled, repository, remote, readDraft, t, target, messages, document, demo]);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Loading synchronizes a persisted workspace document and its recovery draft; the request lifecycle owns loading, error and conflict state. */
    void load();
    /* eslint-enable react/set-state-in-effect */
  }, [load]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      // A tab of an earlier version still writes drafts; this one adopts them as the device's copy.
      if (event.key === key || (device && event.key === device)) void load();
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [key, device, load]);
  const change = (next: T) => {
    if (!snapshot?.writable || loading || error || snapshotKey !== key || !repository) return;
    const result = document.schema.safeParse(next);
    if (!result.success) {
      setError(t(messages.limit));
      return;
    }
    if (device) {
      try {
        if (!writeDeviceDocument(client, { id: repository, alias }, result.data)) return;
      } catch {
        setError(t(messages.draft));
        return;
      }
      current.current = result.data;
      setPage(result.data);
      return;
    }
    try {
      const previous = readDraft();
      if (previous && previous.id !== draftIdentity.current) {
        setError(t(messages.conflict));
        return;
      }
      const id = crypto.randomUUID();
      writeDocumentDraft(client, { id: repository, alias }, { page: result.data, base: base.current, revision: revision.current, id, ancestors: [...(previous?.ancestors ?? []), ...(previous?.id ? [previous.id] : [])].slice(-100) });
      draftIdentity.current = id;
      current.current = result.data;
      setPage(result.data);
      setDirty(true);
    } catch {
      setError(t(messages.draft));
    }
  };
  const save = useCallback(async () => {
    if (remote || saving || loading || error || snapshotKey !== key || !snapshot?.writable || !dirty) return;
    const sent = current.current;
    const sentDraft = readDraft();
    if (!sentDraft || !same(sentDraft.page, sent) || sentDraft.id !== draftIdentity.current) {
      setError(t(messages.conflict));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sent, revision: revision.current, repository }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? messages.conflict : messages.save));
      const record: Snapshot<T> = await response.json();
      if (currentKey.current !== key) return;
      const latest = readDraft();
      const settled = settleDocumentDraft(client as WorkspaceDocumentClient<unknown>, { id: repository ?? '', alias }, sentDraft, record.revision);
      if (!settled) {
        if (latest) {
          current.current = latest.page;
          base.current = latest.base;
          revision.current = latest.revision;
          draftIdentity.current = latest.id;
          setPage(latest.page);
        }
        setError(t(messages.conflict));
        saved.current();
        return;
      }
      revision.current = record.revision;
      base.current = record.page;
      setSnapshot(record);
      // Another tab may have edited while this request was in flight.
      current.current = latest?.page || current.current;
      setPage(current.current);
      const pending = !same(current.current, sent);
      setDirty(pending);
      draftIdentity.current = latest?.id;
      saved.current();
    } catch (error) {
      if (currentKey.current === key) setError((error as Error).message);
    } finally {
      if (currentKey.current === key) setSaving(false);
    }
  }, [remote, saving, loading, error, snapshotKey, snapshot, dirty, key, readDraft, t, target, repository, alias, messages, client]);
  useEffect(() => {
    if (!enabled || loading || remote || !dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [page, enabled, loading, remote, dirty, saving, error, save]);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  const diff = dirty ? documentDiff(document.file, base.current, page) : '';
  /* eslint-enable react/refs */
  return { client: client as WorkspaceDocumentClient<unknown>, repository, file: document.file, device: Boolean(device), page: snapshotKey === key ? page : document.empty(), change, save, reload: () => load(true), refresh: () => load(), loading: loading || snapshotKey !== key, saving, dirty: snapshotKey === key && dirty, error, writable: Boolean(enabled && repository && snapshotKey === key && !loading && !error && snapshot?.writable), setError, diff };
}
export type WorkspaceDocumentController<T> = ReturnType<typeof useWorkspaceDocument<T>>;
