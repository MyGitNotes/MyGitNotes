import { describe, expect, it } from 'vitest';
import { iconDirective, searchIconNames } from './icon-search.js';

const NAMES = ['Heart', 'FileText', 'File', 'FilePlus', 'User', 'UserCheck', 'Users', 'Home', 'House', 'Table2', 'ArrowDown01', 'BookUser'];

describe('searchIconNames', () => {
  it('lists the names in order when there is no query', () => {
    expect(searchIconNames(NAMES, '', 3)).toEqual({ names: ['ArrowDown01', 'BookUser', 'File'], total: NAMES.length });
  });

  it('puts an exact name first, then names that start with the query, then the rest', () => {
    expect(searchIconNames(NAMES, 'user', 10).names).toEqual(['User', 'UserCheck', 'Users', 'BookUser']);
  });

  it('matches kebab-case, spaces and lower case alike', () => {
    expect(searchIconNames(NAMES, 'file-text', 10).names).toEqual(['FileText']);
    expect(searchIconNames(NAMES, 'file text', 10).names).toEqual(['FileText']);
    expect(searchIconNames(NAMES, 'FILETEXT', 10).names).toEqual(['FileText']);
    expect(searchIconNames(NAMES, 'table-2', 10).names).toEqual(['Table2']);
  });

  it('needs every word of the query', () => {
    expect(searchIconNames(NAMES, 'file plus', 10).names).toEqual(['FilePlus']);
    expect(searchIconNames(NAMES, 'file zzz', 10).names).toEqual([]);
  });

  it('caps the list and reports how many names matched', () => {
    expect(searchIconNames(NAMES, 'file', 2)).toEqual({ names: ['File', 'FilePlus'], total: 3 });
  });
});

describe('iconDirective', () => {
  it('writes the name alone, or with a size', () => {
    expect(iconDirective('User')).toBe(':icon{name="User"}');
    expect(iconDirective('FileText', '20')).toBe(':icon{name="FileText" size="20"}');
    expect(iconDirective('FileText', '')).toBe(':icon{name="FileText"}');
  });
});
