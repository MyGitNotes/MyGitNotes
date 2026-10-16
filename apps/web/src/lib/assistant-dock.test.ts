// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ASSISTANT_DOCK_STORAGE_KEY, assistantDock, assistantDockWidth, insideAssistantDock, maxAssistantDockWidth } from './assistant-dock.js';
import { DOCUMENT_PANEL_OPEN_STORAGE_KEY, DOCUMENT_PANEL_STORAGE_KEY, getSavedPanelState, PANEL_OPEN_STORAGE_KEY, PANEL_TOOL_STORAGE_KEY } from './panel-state.js';
import { DOCUMENT_TOOL_IDS, WORKSPACE_TOOL_IDS } from './panel-context.js';

const TOOLS = [...WORKSPACE_TOOL_IDS, ...DOCUMENT_TOOL_IDS];

beforeEach(() => {
  localStorage.clear();
  assistantDock.reload();
});
afterEach(() => localStorage.clear());

it('is closed at 380px by default, and remembers open, width and expanded in the browser', () => {
  expect(assistantDock.get()).toEqual({ open: false, width: 380, expanded: false });
  assistantDock.open();
  assistantDock.setWidth(450, 1440);
  expect(JSON.parse(localStorage.getItem(ASSISTANT_DOCK_STORAGE_KEY)!)).toEqual({ open: true, width: 450, expanded: false });
  assistantDock.setExpanded(true);
  assistantDock.reload();
  expect(assistantDock.get()).toEqual({ open: true, width: 450, expanded: true });
  assistantDock.toggle();
  expect(assistantDock.get().open).toBe(false);
});

it('keeps a dragged width between 320px and half the window, and a chosen width ends the expanded state', () => {
  assistantDock.setExpanded(true);
  assistantDock.setWidth(100, 1440);
  expect(assistantDock.get()).toMatchObject({ width: 320, expanded: false });
  assistantDock.setWidth(5000, 1440);
  expect(assistantDock.get().width).toBe(720);
  expect(maxAssistantDockWidth(1440)).toBe(720);
});

it('shows the chosen width within the window, or half the window up to 760px when expanded', () => {
  expect(assistantDockWidth({ width: 380, expanded: false }, 1440)).toBe(380);
  // A window narrower than twice the chosen width holds the dock to half of it.
  expect(assistantDockWidth({ width: 600, expanded: false }, 900)).toBe(450);
  expect(assistantDockWidth({ width: 380, expanded: true }, 1000)).toBe(500);
  expect(assistantDockWidth({ width: 380, expanded: true }, 1440)).toBe(720);
  expect(assistantDockWidth({ width: 380, expanded: true }, 2400)).toBe(760);
});

it('ignores a damaged saved state', () => {
  localStorage.setItem(ASSISTANT_DOCK_STORAGE_KEY, '{nope');
  assistantDock.reload();
  expect(assistantDock.get()).toEqual({ open: false, width: 380, expanded: false });
  localStorage.setItem(ASSISTANT_DOCK_STORAGE_KEY, JSON.stringify({ open: 'yes', width: 'wide', expanded: 1 }));
  assistantDock.reload();
  expect(assistantDock.get()).toEqual({ open: false, width: 380, expanded: false });
});

it('opens the dock for a right panel saved open on the agent, and leaves the panel closed on a tool that exists', () => {
  localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'agent');
  localStorage.setItem(PANEL_OPEN_STORAGE_KEY, 'true');
  expect(getSavedPanelState(TOOLS)).toEqual({ open: false, tool: 'todo' });
  expect(assistantDock.get().open).toBe(true);
  // Once migrated, the saved state is plain: the panel stays closed on the next load, and the dock keeps its own state.
  expect(localStorage.getItem(PANEL_OPEN_STORAGE_KEY)).toBe('false');
  expect(localStorage.getItem(PANEL_TOOL_STORAGE_KEY)).toBe('todo');
  assistantDock.close();
  expect(getSavedPanelState(TOOLS)).toEqual({ open: false, tool: 'todo' });
  expect(assistantDock.get().open).toBe(false);
});

it('does not open the dock for a closed right panel that merely last showed the agent', () => {
  localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'agent');
  localStorage.setItem(PANEL_OPEN_STORAGE_KEY, 'false');
  expect(getSavedPanelState(TOOLS)).toEqual({ open: false, tool: 'todo' });
  expect(assistantDock.get().open).toBe(false);
});

it("opens the dock for a note's document panel saved open on the agent, and forgets the section", () => {
  localStorage.setItem(DOCUMENT_PANEL_STORAGE_KEY, 'agent');
  localStorage.setItem(DOCUMENT_PANEL_OPEN_STORAGE_KEY, 'true');
  localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'calendar');
  expect(getSavedPanelState(TOOLS)).toEqual({ open: false, tool: 'calendar' });
  expect(assistantDock.get().open).toBe(true);
  expect(localStorage.getItem(DOCUMENT_PANEL_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem(DOCUMENT_PANEL_OPEN_STORAGE_KEY)).toBe('false');
});

it('leaves the rail and the document panel alone when neither was on the agent', () => {
  localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'changes');
  localStorage.setItem(PANEL_OPEN_STORAGE_KEY, 'true');
  localStorage.setItem(DOCUMENT_PANEL_STORAGE_KEY, 'outline');
  localStorage.setItem(DOCUMENT_PANEL_OPEN_STORAGE_KEY, 'true');
  expect(getSavedPanelState(TOOLS)).toEqual({ open: true, tool: 'changes' });
  expect(assistantDock.get().open).toBe(false);
  expect(localStorage.getItem(DOCUMENT_PANEL_STORAGE_KEY)).toBe('outline');
});

it('recognizes keys typed inside the dock, and the context menu it opens', () => {
  const dock = document.createElement('div');
  dock.className = 'assistant-dock';
  const field = document.createElement('textarea');
  dock.append(field);
  const menu = document.createElement('div');
  menu.className = 'assistant-dock-menu';
  document.body.append(dock, menu);
  expect(insideAssistantDock(field)).toBe(true);
  expect(insideAssistantDock(menu)).toBe(true);
  expect(insideAssistantDock(document.body)).toBe(false);
  expect(insideAssistantDock(null)).toBe(false);
  dock.remove();
  menu.remove();
});
