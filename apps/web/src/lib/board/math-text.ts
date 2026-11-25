import { findMath, renderMath } from '../math.js';

const subscripts = '₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ₊₋';
const subKeys = '0123456789aehijklmnoprstuvx+−';
const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻';
const superKeys = '0123456789ni+−';

function script(text: string, upper: boolean): string {
  const keys = upper ? superKeys : subKeys;
  if (![...text].every(c => keys.includes(c))) return upper ? `^(${text})` : `₍${text}₎`;
  return [...text].map(c => (upper ? superscripts : subscripts)[keys.indexOf(c)]).join('');
}

/** Read presentation MathML only. Unknown two-dimensional layouts get a marker rather than misleading flattened text. */
function linear(node: Element): string {
  const children = [...node.children].map(linear);
  const text = node.textContent ?? '';
  switch (node.localName) {
    case 'mn':
    case 'mi':
    case 'mtext':
      return text;
    case 'mo':
      return text === '\u2061' ? '' : text === ',' ? ', ' : /^[=+−∈⇒]$/.test(text) ? ` ${text} ` : text;
    case 'mspace':
      return ' ';
    case 'mrow':
    case 'mstyle':
      return children.join('');
    case 'msub':
      return children[0] + script(children[1], false);
    case 'msup':
      return children[0] + script(children[1], true);
    case 'msubsup':
      return children[0] + script(children[1], false) + script(children[2], true);
    case 'mfrac':
      return `(${children[0]})/(${children[1]})`;
    case 'msqrt':
      return `√(${children.join('')})`;
    default:
      return 'ƒ';
  }
}

export function boardMathText(source: string): string {
  let text = '', end = 0;
  for (const span of findMath(source)) {
    const doc = new DOMParser().parseFromString(renderMath(span.tex, span.display, 'mathml'), 'text/html');
    const root = doc.querySelector('semantics > :first-child');
    const formula = root && linear(root);
    text += source.slice(end, span.from) + (formula && !formula.includes('\\') ? formula.trim() : 'ƒ');
    end = span.to;
  }
  return text + source.slice(end);
}
