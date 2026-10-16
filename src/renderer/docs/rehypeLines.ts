import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';

const BLOCKS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'pre',
  'blockquote',
  'table',
  'hr',
]);

/** Copies each block element's Markdown source lines onto it as data-line-start / data-line-end (Send to and Source view use them). */
export function rehypeLines() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!BLOCKS.has(node.tagName) || !node.position) return;
      node.properties.dataLineStart = node.position.start.line;
      node.properties.dataLineEnd = node.position.end.line;
    });
  };
}
