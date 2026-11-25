// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { NoteExportItems } from './NoteExportMenu.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll('iframe').forEach(frame => frame.remove());
});

const menu = () =>
  render(
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>Export</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <NoteExportItems path='notes/a/a.md' title='Alpha' content={'# Alpha\n\nBody text.'} onCopy={vi.fn()} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>,
  );
const open = async () => {
  const trigger = screen.getByRole('button', { name: 'Export' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
};

it('lists Copy, Download (.md) and Download (PDF)', async () => {
  menu();
  await open();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Copy', 'Download (.md)', 'Download (PDF)']);
});

it('downloads the note content as a markdown file named after the note', async () => {
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((value: Blob | MediaSource) => (blob = value as Blob, 'blob:note'));
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
    expect(this.download).toBe('a.md');
  });
  menu();
  await open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download (.md)' }));
  expect(click).toHaveBeenCalledOnce();
  expect(await blob?.text()).toBe('# Alpha\n\nBody text.');
});

it('prints the rendered note from a hidden frame for PDF export', async () => {
  render(
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>Export</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <NoteExportItems path='notes/a/a.md' title='Alpha' content={'# Alpha\n\n![Diagram](attachments/diagram.png)'} onCopy={vi.fn()} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>,
  );
  await open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download (PDF)' }));
  // The frame appears once the note's diagrams have been drawn.
  await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  const frame = document.querySelector('iframe');
  expect(frame?.srcdoc).toContain('<title>Alpha</title>');
  expect(frame?.srcdoc).toContain('<h1');
  expect(frame?.srcdoc).toContain('/raw-assets/notes/a/attachments/diagram.png');
  expect(frame?.srcdoc).not.toContain('loading="lazy"');
});

it('offers Download with images only for a note that references private R2 objects, and saves the note with them as a ZIP', async () => {
  const asked: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    asked.push(String(input));
    return new Response('map bytes');
  });
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((value: Blob | MediaSource) => (blob = value as Blob, 'blob:archive'));
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
    expect(this.download).toBe('a.zip');
  });
  render(
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>Export</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <NoteExportItems path='notes/a/a.md' title='Alpha' content={'# Alpha\n\n![Map](<r2:a/maps/old west.png>)'} onCopy={vi.fn()} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>,
  );
  await open();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Copy', 'Download (.md)', 'Download with images (.zip)', 'Download (PDF)']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download with images (.zip)' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(asked).toEqual(['/r2-assets/a/maps/old%20west.png?note=notes%2Fa%2Fa.md']);
  expect(blob?.type).toBe('application/zip');
  const bytes = new Uint8Array(await blob!.arrayBuffer());
  // A ZIP: the local header signature first, and the object's bytes inside.
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(new TextDecoder().decode(bytes)).toContain('map bytes');
  expect(new TextDecoder().decode(bytes)).toContain('![Map](<assets/a/maps/old west.png>)');
});
