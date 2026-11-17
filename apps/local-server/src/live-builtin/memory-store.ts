import { randomBytes } from 'node:crypto';
import type { RepositoryId } from '@mygitnotes/core';
import { LIVE_ENDED_MAX_BYTES, LIVE_MERGE_MS, LIVE_PRESENCE_MS, LIVE_TICKET_MS, type LiveStore, type StoredEditor, type StoredLink, type StoredTicket } from './store.js';

interface Lease {
  token: string;
  until: number;
  /** What the lease's last `detail` read. */
  readSeq?: number;
  readHash?: string;
}

/**
 * The live store in memory: the calls of the Redis store over Maps. Each call runs to its end without a pause, so it is
 * as atomic as a Redis script. It is for tests, the dev composition, and a deployment that accepts losing live text on
 * restart. Two adapter instances may share one, as two processes share a Redis. Answers are copies, as a Redis reply is.
 */
export function memoryLiveStore(): LiveStore {
  const links = new Map<string, StoredLink>();
  /** `<repository>\n<path>` to the link id; kept after a release. */
  const paths = new Map<string, string>();
  /** The document of each link's live epoch. */
  const documents = new Map<string, { state: Uint8Array; log: Uint8Array[]; }>();
  const editors = new Map<string, Map<string, StoredEditor>>();
  const leases = new Map<string, Lease>();
  /** Per link, each process's entry: when it was written, and person key to last activity. */
  const presence = new Map<string, Map<string, { at: number; people: Record<string, number>; }>>();
  const tickets = new Map<string, { ticket: StoredTicket; until: number; }>();
  const initial = new Map<string, string>();
  const merges = new Map<string, { answer: string; until: number; }>();
  /** `<id>.<epoch>` of each released epoch to the document it ended with, until a day after. */
  const ended = new Map<string, { state: Uint8Array; log: Uint8Array[]; until: number; }>();

  const pathKey = (repository: RepositoryId, path: string) => `${repository}\n${path}`;
  const liveLinks = () => [...links.values()].filter(link => link.live);
  /** The link and its lease, when `token` holds it at `now`. */
  const held = (id: string, token: string, now: number) => {
    const link = links.get(id), lease = leases.get(id);
    return link?.live && lease && lease.token === token && lease.until > now ? { link, lease } : null;
  };
  /** Deletes what an epoch leaves besides its link record. */
  const erase = (id: string) => {
    documents.delete(id);
    editors.delete(id);
    presence.delete(id);
    leases.delete(id);
    for (const [hash, issued] of tickets) if (issued.ticket.id === id) tickets.delete(hash);
  };

  return {
    async check() {},
    async repositories() {
      return [...new Set(liveLinks().map(link => link.repository))].sort();
    },
    async links(repository) {
      return liveLinks().filter(link => link.repository === repository).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1)).map(link => structuredClone(link));
    },
    async link(id) {
      const link = links.get(id);
      return link ? structuredClone(link) : null;
    },
    async checkout(repository, { path, notebook, base, contentHash }, state, now) {
      const known = links.get(paths.get(pathKey(repository, path)) ?? '');
      if (known?.live) return { link: structuredClone(known), outcome: 'joined' };
      const fresh = { notebook, since: now, live: true, base: structuredClone(base), syncedAt: null, syncedHash: null, lastEditAt: null, conflict: null, gen: 0, contentHash };
      const link: StoredLink = known ? { ...known, ...fresh, epoch: known.epoch + 1, contentSeq: known.seq } : { id: randomBytes(16).toString('base64url'), repository, path, ...fresh, epoch: 1, seq: 0, contentSeq: 0 };
      // A reopened epoch starts with no move of its own.
      delete link.target;
      delete link.unmoved;
      links.set(link.id, link);
      paths.set(pathKey(repository, path), link.id);
      documents.set(link.id, { state: new Uint8Array(state), log: [] });
      return { link: structuredClone(link), outcome: known ? 'reopened' : 'created' };
    },
    async createPending(repository, { notebook, base, contentHash, pathRule, initialText }, state, now) {
      const link: StoredLink = { id: randomBytes(16).toString('base64url'), repository, notebook, path: null, pathRule, since: now, epoch: 1, live: true, base: structuredClone(base), syncedAt: null, syncedHash: null, lastEditAt: null, conflict: null, seq: 0, gen: 0, contentHash, contentSeq: 0 };
      links.set(link.id, link);
      documents.set(link.id, { state: new Uint8Array(state), log: [] });
      if (initialText !== undefined) initial.set(link.id, initialText);
      return structuredClone(link);
    },
    async initialText(id) {
      return initial.get(id) ?? null;
    },
    async document(id, epoch) {
      const link = links.get(id), document = documents.get(id);
      if (!link?.live || link.epoch !== epoch || !document) return null;
      return { state: new Uint8Array(document.state), log: document.log.map(update => new Uint8Array(update)), gen: link.gen, seq: link.seq };
    },
    async append(id, epoch, update, editor, now, merge) {
      const link = links.get(id), document = documents.get(id);
      if (!link?.live || link.epoch !== epoch || !document) return 'not-live';
      if (merge) {
        const known = merges.get(merge.key);
        if (known && known.until > now) return { merged: known.answer };
        for (const [key, entry] of merges) if (entry.until <= now) merges.delete(key);
        merges.set(merge.key, { answer: merge.answer, until: merge.until });
      }
      document.log.push(new Uint8Array(update));
      link.seq += 1;
      if (editor) {
        link.lastEditAt = now;
        const listed = editors.get(id) ?? new Map<string, StoredEditor>();
        editors.set(id, listed);
        const known = listed.get(editor.key);
        if (known) Object.assign(known, { lastAt: now, lastSeq: link.seq });
        else listed.set(editor.key, { key: editor.key, name: editor.name, ...(editor.email !== undefined ? { email: editor.email } : {}), agent: editor.agent, ...(editor.person !== undefined ? { person: { realm: editor.person.realm, userId: editor.person.userId } } : {}), firstAt: now, lastAt: now, lastSeq: link.seq });
      }
      return { seq: link.seq, length: document.log.length };
    },
    async ended(id, epoch, now) {
      const document = ended.get(`${id}.${epoch}`);
      return document && document.until > now ? { state: new Uint8Array(document.state), log: document.log.map(update => new Uint8Array(update)) } : null;
    },
    async mergeAnswer(key, now) {
      const known = merges.get(key);
      return known && known.until > now ? known.answer : null;
    },
    async compact(id, epoch, gen, count, state, contentHash, contentSeq) {
      const link = links.get(id), document = documents.get(id);
      if (!link?.live || link.epoch !== epoch || link.gen !== gen || !document || !Number.isSafeInteger(count) || count < 0 || count > document.log.length) return false;
      document.state = new Uint8Array(state);
      document.log.splice(0, count);
      Object.assign(link, { gen: link.gen + 1, contentHash, contentSeq });
      return true;
    },
    async editors(id) {
      return [...(editors.get(id)?.values() ?? [])].sort((a, b) => a.firstAt - b.firstAt || (a.key < b.key ? -1 : 1)).map(editor => structuredClone(editor));
    },
    async lease(id, token, until, now) {
      if (!links.get(id)?.live) return 'not-live';
      const lease = leases.get(id);
      if (lease && lease.until > now) return 'held';
      leases.set(id, { token, until });
      return 'leased';
    },
    async leaseHeld(id, token, now) {
      return held(id, token, now) !== null;
    },
    async leaseRead(id, token, seq, contentHash, now) {
      const grip = held(id, token, now);
      if (!grip) return false;
      Object.assign(grip.lease, { readSeq: seq, readHash: contentHash });
      return true;
    },
    async synced(id, token, receipt, now) {
      const grip = held(id, token, now);
      if (!grip) return 'leased';
      const { link, lease } = grip;
      if (link.path !== null && link.path !== receipt.path && link.target !== receipt.path) return 'path-fixed';
      if (link.path === null) {
        link.path = receipt.path;
        delete link.pathRule;
        initial.delete(id);
        paths.set(pathKey(link.repository, receipt.path), id);
      } else if (link.target !== undefined) {
        // Moved to its target, the link is named by its new path alone; kept in place, it remembers the target it did not take.
        if (receipt.path === link.target) {
          if (paths.get(pathKey(link.repository, link.path)) === id) paths.delete(pathKey(link.repository, link.path));
          link.path = receipt.path;
          paths.set(pathKey(link.repository, receipt.path), id);
          delete link.unmoved;
        } else link.unmoved = link.target;
        delete link.target;
      }
      Object.assign(link, { base: { commit: receipt.commit, blob: receipt.blob, contentHash: receipt.contentHash }, syncedAt: now, syncedHash: receipt.contentHash, conflict: structuredClone(receipt.conflict) });
      // The receipt's text is the text at the cut: whoever last typed at or before it is in the commit.
      const cut = lease.readHash === receipt.contentHash ? lease.readSeq! : link.contentHash === receipt.contentHash && link.contentSeq === link.seq ? link.seq : null;
      if (cut !== null) {
        for (const editor of editors.get(id)?.values() ?? []) if (editor.lastSeq <= cut) editors.get(id)!.delete(editor.key);
      }
      return 'ok';
    },
    async release(id, token, expect, now) {
      const grip = held(id, token, now);
      if (!grip) return 'leased';
      if (grip.link.syncedAt === null || grip.link.syncedHash !== expect.contentHash) return 'not-synced';
      if (grip.link.seq !== expect.seq) return 'changed';
      grip.link.live = false;
      for (const [name, document] of ended) if (document.until <= now) ended.delete(name);
      const document = documents.get(id);
      // Only an epoch that stored typing keeps its document, and only up to the bound (cfx-F002).
      const typed = document && (grip.link.gen > 0 || document.log.length > 0);
      if (document && typed && document.log.reduce((sum, update) => sum + update.byteLength, document.state.byteLength) <= LIVE_ENDED_MAX_BYTES) ended.set(`${id}.${grip.link.epoch}`, { ...document, until: now + LIVE_MERGE_MS });
      erase(id);
      return 'released';
    },
    async discard(id, token, expect, now) {
      const grip = held(id, token, now);
      if (!grip) return 'leased';
      if (grip.link.path !== null) return 'not-pending';
      if (grip.link.seq !== expect.seq) return 'changed';
      links.delete(id);
      initial.delete(id);
      erase(id);
      return 'discarded';
    },
    async retarget(id, token, change, now) {
      const grip = held(id, token, now);
      if (!grip) return 'leased';
      leases.delete(id);
      const { link } = grip;
      if (typeof change === 'string') {
        if (link.path !== null) return 'not-pending';
        link.pathRule = change;
        return 'retargeted';
      }
      if (link.path === null) return 'not-filed';
      if (change.target === null) delete link.target;
      else link.target = change.target;
      delete link.unmoved;
      return 'retargeted';
    },
    async unlease(id, token, now) {
      if (held(id, token, now)) leases.delete(id);
    },
    async presence(id, process, people, now) {
      if (!links.get(id)?.live) return;
      const entries = presence.get(id) ?? new Map<string, { at: number; people: Record<string, number>; }>();
      for (const [name, entry] of entries) if (entry.at + LIVE_PRESENCE_MS <= now) entries.delete(name);
      if (Object.keys(people).length) entries.set(process, { at: now, people: { ...people } });
      else entries.delete(process);
      if (entries.size) presence.set(id, entries);
      else presence.delete(id);
    },
    async activePeople(id, since, now) {
      const active = new Set<string>();
      for (const entry of presence.get(id)?.values() ?? []) {
        if (entry.at + LIVE_PRESENCE_MS <= now) continue;
        for (const [person, last] of Object.entries(entry.people)) if (last >= since) active.add(person);
      }
      return active.size;
    },
    async putTicket(hash, ticket, until) {
      // A ticket is put when issued, LIVE_TICKET_MS before its end: those ended by then are gone.
      const issued = until - LIVE_TICKET_MS;
      for (const [other, entry] of tickets) if (entry.until <= issued) tickets.delete(other);
      tickets.set(hash, { ticket: structuredClone(ticket), until });
    },
    async takeTicket(hash, now) {
      const issued = tickets.get(hash);
      for (const [other, entry] of tickets) if (other === hash || entry.until <= now) tickets.delete(other);
      return issued && issued.until > now ? issued.ticket : null;
    },
  };
}
