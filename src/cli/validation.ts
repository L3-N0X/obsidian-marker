import { inlineLinkTargets } from './content';

function values(text: string, pattern: RegExp): string[] {
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) result.push(match[1] === undefined ? match[0] : match[1]);
  return result;
}

function frontmatter(text: string): string {
  return text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
}

function links(text: string): string[] {
  return [...inlineLinkTargets(text), ...values(text, /\[\[([^\]]+)\]\]/g).map(link => link.split('|')[0]),
    ...values(text, /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm).map(link => link.startsWith('<') ? link.slice(1, -1) : link)];
}

function protectedBlocks(text: string): string[] {
  return [...values(text, /^\s*```[^\n]*\n([\s\S]*?)^\s*```\s*$/gm),
    ...values(text, /^\s*~~~[^\n]*\n([\s\S]*?)^\s*~~~\s*$/gm),
    ...values(text, /\$\$([\s\S]*?)\$\$/g), ...values(text, /\\\[([\s\S]*?)\\\]/g),
    ...values(text, /(?<!\$)\$(?!\$)([^\n$]+)\$(?!\$)/g), ...values(text, /\\\(([\s\S]*?)\\\)/g)];
}

export function validateFormatted(original: string, formatted: string): void {
  if (!formatted.trim() || formatted.includes('\0')) throw new Error('CLI produced an empty or invalid document');
  if (frontmatter(original) !== frontmatter(formatted)) throw new Error('CLI changed protected frontmatter');
  const missingLink = links(original).find(link => !links(formatted).includes(link));
  if (missingLink) throw new Error('CLI removed or changed an original link target');
  const outputBlocks = protectedBlocks(formatted).map(block => block.replace(/\r\n/g, '\n'));
  if (protectedBlocks(original).some(block => !outputBlocks.includes(block.replace(/\r\n/g, '\n')))) {
    throw new Error('CLI removed or changed protected code or math content');
  }
  // Unique numeric values allow identical footnotes to be canonicalized without false failures.
  const numeric = /\d+(?:[.,:/-]\d+)*/g;
  const withoutFootnoteLabels = (text: string): string => text.replace(/\[\^[^\]]+\]/g, '');
  const remaining = new Set(withoutFootnoteLabels(formatted).match(numeric) || []);
  if ((withoutFootnoteLabels(original).match(numeric) || []).some(value => !remaining.has(value))) {
    throw new Error('CLI removed or changed an original numeric or date value');
  }
  // Catch disappearance of unique names/terms in any language, while allowing duplicate footnotes.
  const words = new RegExp('[\\p{L}\\p{M}]+', 'gu');
  const outputWords = new Set(formatted.match(words) || []);
  if ((original.match(words) || []).some(word => !outputWords.has(word))) {
    throw new Error('CLI removed an original word or name');
  }
}
