import { describe, expect, it } from 'vitest';
import { isSortField, metadataSortKey, sortNotes } from '../src/note-sort.js';
import { parseNoteQuery } from '../src/note-catalog.js';
import { noteQuerySearch } from '../src/note-query.js';

const note = (title: string, metadata: Record<string, unknown> = {}, mtime = 0) => ({ title, metadata, mtime });

describe('sort fields', () => {
  it('accepts the built-in fields and metadata.<key>', () => {
    for (const field of ['updated', 'created', 'title', 'status', 'metadata.date', 'metadata.meeting-date', 'metadata.會議日期']) expect(isSortField(field)).toBe(true);
    for (const field of ['', 'date', 'metadata.', 'metadata.a b', 'metadata.a.b', 'Metadata.date', 'manual', 42, undefined]) expect(isSortField(field)).toBe(false);
  });
  it('names the frontmatter key of a metadata field', () => {
    expect(metadataSortKey('metadata.date')).toBe('date');
    expect(metadataSortKey('title')).toBeUndefined();
  });
});

describe('sorting by a metadata key', () => {
  const meetings = [note('B', { date: '2026-03-10' }), note('A', { date: '2026-11-02' }), note('C', { date: '2025-12-31' })];
  it('compares values that parse as dates as dates', () => {
    expect(sortNotes(meetings, 'metadata.date', 'desc').map(n => n.title)).toEqual(['A', 'B', 'C']);
    expect(sortNotes(meetings, 'metadata.date', 'asc').map(n => n.title)).toEqual(['C', 'B', 'A']);
  });
  it('compares dates by time, not by text, across offsets and Date objects', () => {
    const mixed = [note('c', { date: '2026-01-05T03:00:00Z' }), note('b', { date: '2026-01-05T09:00:00+08:00' }), note('a', { date: new Date('2026-01-04T23:00:00Z') })];
    expect(sortNotes(mixed, 'metadata.date', 'asc').map(n => n.title)).toEqual(['a', 'b', 'c']);
  });
  it('does not take a plain number or a short numeric string for a date', () => {
    const numbered = [note('ten', { order: '10' }), note('nine', { order: 9 }), note('two', { order: '2' })];
    expect(sortNotes(numbered, 'metadata.order', 'asc').map(n => n.title)).toEqual(['two', 'nine', 'ten']);
  });
  it('compares other values as natural, case-insensitive strings', () => {
    const rooms = [note('1', { room: 'Room 10' }), note('2', { room: 'room 9' }), note('3', { room: 'Annex' })];
    expect(sortNotes(rooms, 'metadata.room', 'asc').map(n => n.title)).toEqual(['3', '2', '1']);
    expect(sortNotes(rooms, 'metadata.room', 'desc').map(n => n.title)).toEqual(['1', '2', '3']);
  });
  it('puts notes without the key last in both orders, also empty and unusable values', () => {
    const notes = [note('none', {}), note('dated', { date: '2026-01-01' }), note('empty', { date: '  ' }), note('null', { date: null }), note('object', { date: { a: 1 } }), note('newer', { date: '2026-02-01' })];
    expect(sortNotes(notes, 'metadata.date', 'desc').map(n => n.title).slice(0, 2)).toEqual(['newer', 'dated']);
    expect(sortNotes(notes, 'metadata.date', 'asc').map(n => n.title).slice(0, 2)).toEqual(['dated', 'newer']);
    for (const order of ['asc', 'desc'] as const) expect(new Set(sortNotes(notes, 'metadata.date', order).map(n => n.title).slice(2))).toEqual(new Set(['none', 'empty', 'null', 'object']));
  });
  it('breaks ties by updated, newest first, in both orders, also among notes without the key', () => {
    const notes = [note('old', { date: '2026-05-01', updated: '2026-05-02T00:00:00Z' }), note('new', { date: '2026-05-01', updated: '2026-06-02T00:00:00Z' }), note('gone-old', { updated: '2026-01-01T00:00:00Z' }), note('gone-new', { updated: '2026-02-01T00:00:00Z' })];
    for (const order of ['asc', 'desc'] as const) expect(sortNotes(notes, 'metadata.date', order).map(n => n.title)).toEqual(['new', 'old', 'gone-new', 'gone-old']);
  });
  it('keeps dates before other text when one list holds both, and does not mutate the input', () => {
    const notes = [note('text', { v: 'soon' }), note('day', { v: '2026-01-01' })];
    const copy = [...notes];
    expect(sortNotes(notes, 'metadata.v', 'asc').map(n => n.title)).toEqual(['day', 'text']);
    expect(sortNotes(notes, 'metadata.v', 'desc').map(n => n.title)).toEqual(['text', 'day']);
    expect(notes).toEqual(copy);
  });
  it('joins a list value into text', () => {
    const notes = [note('b', { team: ['b', 'x'] }), note('a', { team: ['a'] })];
    expect(sortNotes(notes, 'metadata.team', 'asc').map(n => n.title)).toEqual(['a', 'b']);
  });
});

describe('the query takes a metadata sort', () => {
  it('parses and serializes sort=metadata.<key>', () => {
    const { query } = parseNoteQuery({ notebookId: 'meetings', sort: 'metadata.date', order: 'desc' });
    expect(query.sort).toBe('metadata.date');
    expect(noteQuerySearch({ notebookId: 'meetings', sort: 'metadata.date' }).get('sort')).toBe('metadata.date');
    expect(() => parseNoteQuery({ notebookId: 'meetings', sort: 'metadata.' })).toThrow(/Invalid query option/);
    expect(() => parseNoteQuery({ notebookId: 'meetings', sort: 'date' })).toThrow(/Invalid query option/);
  });
});
