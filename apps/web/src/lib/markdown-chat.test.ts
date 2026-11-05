// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from './markdown.js';

const base = { folder: 'notes/a', repositoryRoot: '/home/me/workspace' };
const html = (text: string) => {
  const container = document.createElement('div');
  container.innerHTML = renderChatMarkdown(text, base);
  return container;
};

describe('renderChatMarkdown', () => {
  it('renders the reply as Markdown, with code, lists and tables', () => {
    const view = html('**Done**\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(view.querySelector('strong')?.textContent).toBe('Done');
    expect(view.querySelectorAll('li')).toHaveLength(2);
    expect(view.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(view.querySelector('.markdown-table-scroll table')).not.toBeNull();
  });

  it('makes note links workspace links resolved from the folder Pi runs in, including absolute paths inside the repository', () => {
    const view = html('[plan](plan.md) [up](../b/x.md) [abs](/home/me/workspace/notes/a/plan.md)');
    const links = [...view.querySelectorAll('a')];
    expect(links.map(link => link.dataset.workspaceLink)).toEqual(['plan.md', '../b/x.md', '/notes/a/plan.md']);
    expect(links.every(link => link.dataset.sourcePath === 'notes/a/.pi-agent' && !link.target)).toBe(true);
  });

  it('opens web links in a new tab, and leaves paths outside the repository as text', () => {
    const view = html('[site](https://example.com) [elsewhere](/etc/passwd) [script](javascript:alert(1))');
    const [site, elsewhere, script] = [...view.querySelectorAll('a')];
    expect(site.target).toBe('_blank');
    expect(site.rel).toBe('noopener noreferrer');
    expect(elsewhere.hasAttribute('href') || elsewhere.dataset.workspaceLink).toBeFalsy();
    expect(script?.getAttribute('href') ?? null).toBeNull();
  });

  it('keeps only web links when it does not know where Pi runs', () => {
    const container = document.createElement('div');
    container.innerHTML = renderChatMarkdown('[plan](plan.md) [site](https://example.com)');
    const [plan, site] = [...container.querySelectorAll('a')];
    expect(plan.hasAttribute('href')).toBe(false);
    expect(site.target).toBe('_blank');
  });

  it('turns an image from another host into a link to it, so the reply loads nothing until clicked', () => {
    const view = html('![chart](https://e.invalid/p.png?d=SECRET) ![bare](//e.invalid/q.png) <img src="/\\e.invalid/r.png">');
    expect(view.querySelector('img')).toBeNull();
    const links = [...view.querySelectorAll('a.chat-external-image')];
    expect(links.map(link => link.textContent)).toEqual(['chart (https://e.invalid/p.png?d=SECRET)', 'bare (//e.invalid/q.png)', '/\\e.invalid/r.png']);
    expect(links[0].getAttribute('href')).toBe('https://e.invalid/p.png?d=SECRET');
    expect((links[0] as HTMLAnchorElement).target).toBe('_blank');
  });

  it('keeps workspace images', () => {
    const view = html('![b](@/assets/x.png) ![c](img/x.png) ![d](/notes/a/y.png)');
    expect([...view.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['@/assets/x.png', 'img/x.png', '/notes/a/y.png']);
  });

  it('drops every other way a reply could load from another host by itself', () => {
    const view = html(['<span style="background:url(https://e.invalid/s)">styled</span>', '<video poster="https://e.invalid/v" src="https://e.invalid/v2"></video>', '<audio src="https://e.invalid/au"></audio>', '<picture><source srcset="https://e.invalid/ss"><img src="img/x.png"></picture>', '<img srcset="https://e.invalid/set 1x" src="img/y.png">', '<svg><image href="https://e.invalid/svg"></image></svg>', '<input type="image" src="https://e.invalid/in">', '<table background="https://e.invalid/tb"><tr><td>x</td></tr></table>', '<figure class="ann-pdf"><a class="ann-open" href="https://e.invalid/pdf"></a><div class="ann-pages"></div></figure>'].join('\n\n'));
    const loads = [...view.querySelectorAll('*')].flatMap(element => ['src', 'srcset', 'poster', 'background', 'href', 'xlink:href', 'style'].filter(name => element.tagName !== 'A' && (element.getAttribute(name) ?? '').includes('e.invalid')));
    expect(loads).toEqual([]);
    expect(view.querySelector('video, audio, input')).toBeNull();
    expect(view.querySelector('figure.ann-pdf')).toBeNull();
    expect(view.textContent).toContain('styled');
  });

  it('keeps the inline styles math is drawn with', () => {
    expect(html('$x^2$').querySelector('.katex [style]')).not.toBeNull();
  });
});
