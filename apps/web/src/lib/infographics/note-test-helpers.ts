import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createNoteRenderer } from '../markdown.js';

const { window } = new JSDOM('');
const { renderNote } = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), language: 'en' });

export const draw = (source: string, noteLang?: string) => new window.DOMParser().parseFromString(renderNote(source, 'n.md', undefined, undefined, undefined, { noteLang }), 'text/html');
