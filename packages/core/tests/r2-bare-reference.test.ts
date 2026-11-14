import { describe, expect, it } from 'vitest';
import { parseR2Reference, r2Reference, r2ReferenceKeys, rewriteR2References } from '../src/index.js';

const KEYS = ['nb/My Rules.pdf', 'nb/a(1).png', 'nb/100%.pdf', 'nb/c#sharp?.pdf', 'nb/規則書/第一章.pdf', 'nb/party🎉.png', 'nb/it\'s "q" <x>\\y.pdf'];

describe('bare r2 references', () => {
  it('writes a bare form without angle brackets and keeps CJK and emoji readable', () => {
    expect(r2Reference('nb/My Rules.pdf')).toBe('![My Rules.pdf](r2:nb/My%20Rules.pdf)');
    expect(r2Reference('nb/a(1).png')).toBe('![a(1).png](r2:nb/a%281%29.png)');
    expect(r2Reference('nb/100%.pdf')).toBe('![100%.pdf](r2:nb/100%25.pdf)');
    expect(r2Reference('nb/c#sharp?.pdf')).toBe('![c#sharp?.pdf](r2:nb/c%23sharp%3F.pdf)');
    expect(r2Reference('nb/規則書/第一章.pdf')).toBe('![第一章.pdf](r2:nb/規則書/第一章.pdf)');
    expect(r2Reference('nb/party🎉.png')).toBe('![party🎉.png](r2:nb/party🎉.png)');
    for (const key of KEYS) expect(r2Reference(key)).not.toContain('<r2:');
  });

  it('gives each key back through r2ReferenceKeys and parseR2Reference', () => {
    for (const key of KEYS) {
      const markdown = r2Reference(key);
      expect(r2ReferenceKeys(markdown)).toEqual([key]);
      const dest = /\(r2:(.*)\)$/.exec(markdown)![1];
      expect(parseR2Reference(`r2:${dest}`)).toBe(key);
    }
  });

  it('still reads angle-bracket references and keeps their brackets on rewrite', () => {
    const old = '![Rules](<r2:ex/old/Core Rules.pdf>)';
    expect(r2ReferenceKeys(old)).toEqual(['ex/old/Core Rules.pdf']);
    expect(rewriteR2References(old, { 'ex/old/Core Rules.pdf': 'ex/new/Core Rules.pdf' })).toBe('![Rules](<r2:ex/new/Core Rules.pdf>)');
  });

  it('rewrites a bare reference with the same encoder', () => {
    const next = rewriteR2References('[a](r2:ex/a.pdf)', { 'ex/a.pdf': 'ex/規則 (2)#.pdf' });
    expect(next).toBe('[a](r2:ex/規則%20%282%29%23.pdf)');
    expect(r2ReferenceKeys(next)).toEqual(['ex/規則 (2)#.pdf']);
  });
});
