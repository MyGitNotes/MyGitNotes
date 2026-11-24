export function filesInitialPath(search: string, root?: string, assets = 'assets') {
  const params = new URLSearchParams(search);
  const directory = params.get('directory');
  return params.get('asset') || (root && directory !== null ? `${root}/${assets}${directory ? '/' + directory : ''}` : undefined);
}
