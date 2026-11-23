// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode, useMemo } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { expect, it } from 'vitest';
import { readFilterQuery } from '../lib/filter-query.js';
import { parseWorkspaceRoute } from '../lib/routes.js';
import { useWorkspaceNavigation } from './useWorkspaceNavigation.js';

const config = { notebooks: [{ id: 'life', title: 'Life', root: 'notes/life' }, { id: 'thesis', title: 'Thesis', root: 'notes/thesis' }] } as never;
const editorRegistry = { flushEditors: async () => true } as never;
const fileManagerRef = { current: null };
const setFilterQuery = (async () => new URLSearchParams()) as never;
const resolveBareNotebook = (id: string) => id;

/** The Notes page on `life` at `search`, with the navigation the app wires. */
function notesAt(search: string) {
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(MemoryRouter, { initialEntries: [`/notebooks/life${search}`] }, children);
  return renderHook(() => {
    const location = useLocation();
    const route = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
    const queryState = useMemo(() => readFilterQuery(location.search), [location.search]);
    const navigation = useWorkspaceNavigation({ location, navigate: useNavigate(), route, editorRoute: route, activeTab: 'notes', selectedNotebookId: 'life', config, loading: false, resolveBareNotebook, queryState, selectedFolders: [], setFilterQuery, folderRoot: 'notes/life', viewMode: 'flat', selectedFolder: null, editorRegistry, fileManagerRef });
    return { location, navigation };
  }, { wrapper });
}

// UAT (boss): tags 社會 and CoC picked in two notebooks stayed on when thesis opened, so it listed no notes until Clear all.
it("opens another notebook without the last notebook's tags and status, keeping the search", async () => {
  const { result } = notesAt('?tag=%E7%A4%BE%E6%9C%83&tag=CoC&tagMode=all&status=todo&q=causal');
  await act(async () => {
    await result.current.navigation.setSelectedNotebookId('thesis');
  });
  const query = new URLSearchParams(result.current.location.search);
  expect(result.current.location.pathname).toBe('/notebooks/thesis');
  expect(query.getAll('tag')).toEqual([]);
  expect(query.get('tagMode')).toBeNull();
  expect(query.get('status')).toBeNull();
  expect(query.get('q')).toBe('causal');
});
