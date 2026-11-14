import { describe, expect, it } from 'vitest';
import { fileKind, isTextFile, rawFileHeaders } from '../src/file-kind.js';

describe('file kinds', () => {
  it('tells text, PDF, HTML and media apart by extension or well-known name', () => {
    for (const file of ['a.sql', 'a/b.yml', 'a.YAML', 'a.json', 'a.csv', 'a.tsv', 'a.log', 'a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.py', 'a.sh', 'a.go', 'a.rs', 'a.css', 'a.toml', 'a.ini', 'a.xml', 'a.md', 'a.markdown', 'a.mdx', 'a.txt', 'a.tex', 'a.bib', 'x/Makefile', 'Dockerfile', 'LICENSE', 'README', 'a.compilation.yml']) expect([file, fileKind(file)]).toEqual([file, 'text']);
    expect(fileKind('a.pdf')).toBe('pdf');
    expect(fileKind('a.PDF')).toBe('pdf');
    for (const file of ['a.html', 'a.htm', 'a.xhtml', 'A.HTML']) expect([file, fileKind(file)]).toEqual([file, 'html']);
    for (const file of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.svg', 'a.webp', 'a.avif', 'a.ico', 'a.bmp']) expect([file, fileKind(file)]).toEqual([file, 'image']);
    expect(fileKind('a.mp3')).toBe('audio');
    expect(fileKind('a.mp4')).toBe('video');
    for (const file of ['a.zip', 'a.xlsx', 'a.docx', 'a.exe', 'a.woff2', 'noextension', 'a.unknown', 'x.d.ts.map']) expect([file, fileKind(file)]).toEqual([file, 'other']);
    expect(isTextFile('db/schema.sql')).toBe(true);
    expect(isTextFile('spec.pdf')).toBe(false);
  });

  it('serves text as plain text, a PDF inline as a PDF, HTML sandboxed, and keeps other files as they were', () => {
    // A script file is never sent under a script, video or markup type: the browser would run or misread it.
    expect(rawFileHeaders('db/schema.sql')).toEqual({ contentType: 'text/plain; charset=utf-8', contentSecurityPolicy: "default-src 'none'; sandbox" });
    expect(rawFileHeaders('src/main.ts').contentType).toBe('text/plain; charset=utf-8');
    expect(rawFileHeaders('a.md').contentType).toBe('text/plain; charset=utf-8');
    expect(rawFileHeaders('a.xml').contentType).toBe('text/plain; charset=utf-8');
    // The browser's PDF viewer refuses a document under the sandbox directive, and the bytes are only ever read as a PDF.
    expect(rawFileHeaders('spec.pdf')).toEqual({ contentType: 'application/pdf', contentSecurityPolicy: "default-src 'none'" });
    expect(rawFileHeaders('out/index.html')).toEqual({ contentType: 'text/html; charset=utf-8', contentSecurityPolicy: "default-src 'none'; sandbox" });
    expect(rawFileHeaders('a.png')).toEqual({ contentSecurityPolicy: "default-src 'none'; sandbox" });
    expect(rawFileHeaders('a.zip')).toEqual({ contentSecurityPolicy: "default-src 'none'; sandbox" });
  });
});
