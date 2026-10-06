import { MarkerSettings } from '../settings';

export type PromptRuleCondition =
  'always' | 'imageExtraction' | 'noImageExtraction';

export interface PromptRule {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  condition: PromptRuleCondition;
}

export const PROMPT_RULE_CONDITIONS: {
  value: PromptRuleCondition;
  label: string;
}[] = [
  { value: 'always', label: 'Always' },
  { value: 'imageExtraction', label: 'Only with image extraction' },
  { value: 'noImageExtraction', label: 'Only without image extraction' },
];

// Marker the model puts between pages; replaced by the configured separator
export const PAGE_BREAK_MARKER = '<!-- page break -->';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a precise document-to-Markdown converter. You receive pages of a document and transcribe them into clean Markdown for an Obsidian vault. Follow every rule below exactly.';

const DEFAULT_PROMPT_RULES: PromptRule[] = [
  {
    id: 'output',
    name: 'Output',
    enabled: true,
    condition: 'always',
    content: [
      '- Output only the Markdown of the document. No explanations, comments or preamble.',
      '- Do not wrap the output in a code block.',
      '- If a page is empty, output nothing for it.',
    ].join('\n'),
  },
  {
    id: 'transcription',
    name: 'Faithful transcription',
    enabled: true,
    condition: 'always',
    content: [
      '- Transcribe all text exactly as written, in its original language. Do not summarize, translate, paraphrase or correct it.',
      '- Keep the reading order. For multi-column layouts, finish each column top to bottom before starting the next.',
      '- Join lines that belong to the same paragraph and remove hyphenation caused by line breaks.',
      '- Leave out running headers, footers and page numbers.',
    ].join('\n'),
  },
  {
    id: 'structure',
    name: 'Headings and structure',
    enabled: true,
    condition: 'always',
    content: [
      '- Use `#` headings that mirror the document hierarchy. Do not skip heading levels.',
      '- Keep bulleted and numbered lists as Markdown lists, with nesting shown by indentation.',
      '- Put source code in fenced code blocks with a language tag when the language is clear.',
      '- Render quotations as `>` blockquotes.',
    ].join('\n'),
  },
  {
    id: 'tables',
    name: 'Tables',
    enabled: true,
    condition: 'always',
    content: [
      '- Convert every table into a Markdown pipe table with a header row and a `| --- |` separator row.',
      '- Keep every row and column. Never drop, merge or reorder data.',
      '- Escape pipe characters inside cells as `\\|` and use `<br>` for line breaks inside a cell.',
      '- For merged cells, repeat the value in each cell it spans.',
      '- If a table has no header row, use the first row as the header.',
    ].join('\n'),
  },
  {
    id: 'math',
    name: 'Math',
    enabled: true,
    condition: 'always',
    content: [
      '- Write inline math as `$...$` and display equations as `$$...$$` on their own lines, using LaTeX.',
      '- Never put math in code blocks.',
    ].join('\n'),
  },
  {
    id: 'obsidian',
    name: 'Obsidian formatting',
    enabled: true,
    condition: 'always',
    content: [
      '- Turn boxed notes, tips, warnings and sidebars into Obsidian callouts such as `> [!note]`, `> [!tip]` or `> [!warning]`, with the content on the following `> ` lines.',
      '- Use `==text==` for highlighted text, and `**bold**` and `*italic*` where the source uses them.',
      '- Write footnote references as `[^1]` and the footnote text as `[^1]: ...` at the end of the page.',
      '- Render checkboxes as task lists: `- [ ]` and `- [x]`.',
      '- Keep links as `[text](url)`. Do not invent wikilinks (`[[...]]`) or tags.',
    ].join('\n'),
  },
  {
    id: 'pages',
    name: 'Page splitting',
    enabled: true,
    condition: 'always',
    content: [
      '- Transcribe every page you receive, in order.',
      `- When you receive several pages, put a line containing only \`${PAGE_BREAK_MARKER}\` between them, with a blank line before and after.`,
      '- Do not repeat table headers or headings that only exist because content continues on the next page.',
    ].join('\n'),
  },
  {
    id: 'figures',
    name: 'Figures (text only)',
    enabled: true,
    condition: 'noImageExtraction',
    content: [
      '- Do not try to reproduce photos, charts, diagrams or illustrations.',
      '- Replace each one with a short description in italics, e.g. `*[Figure: bar chart of yearly revenue]*`.',
      '- Keep figure captions as normal text.',
    ].join('\n'),
  },
  {
    id: 'image-extraction',
    name: 'Image extraction',
    enabled: true,
    condition: 'imageExtraction',
    content: [
      '- For each photo, chart, diagram or illustration, output a placeholder at its position: `![short description](bbox:x_min,y_min,x_max,y_max)`.',
      '- The coordinates are the bounding box of the figure on the page image, as integers from 0 to 1000 relative to the page width (x) and height (y), with the origin at the top-left corner.',
      '- Make the box cover the whole figure but not its caption. Keep the caption as normal text below the placeholder.',
      '- Do not use placeholders for tables, equations or plain text. Transcribe those instead.',
    ].join('\n'),
  },
];

export function getDefaultPromptRules(): PromptRule[] {
  return DEFAULT_PROMPT_RULES.map((rule) => ({ ...rule }));
}

// Image extraction crops figures from rendered pages, so it needs page images
export function isImageExtractionEnabled(settings: MarkerSettings): boolean {
  return (
    !!settings.openaiExtractImages &&
    settings.openaiInputMode !== 'pdf' &&
    settings.extractContent !== 'text'
  );
}

export function isRuleActive(
  rule: PromptRule,
  imageExtraction: boolean
): boolean {
  if (!rule.enabled || !rule.content.trim()) return false;
  switch (rule.condition) {
    case 'imageExtraction':
      return imageExtraction;
    case 'noImageExtraction':
      return !imageExtraction;
    default:
      return true;
  }
}

export function buildSystemPrompt(
  settings: MarkerSettings,
  imageExtraction: boolean
): string {
  const parts: string[] = [];
  const intro = (settings.openaiSystemPrompt ?? '').trim();
  if (intro) parts.push(intro);

  const rules = (settings.openaiPromptRules ?? []).filter((rule) =>
    isRuleActive(rule, imageExtraction)
  );
  if (rules.length > 0) {
    parts.push('# Rules');
    rules.forEach((rule) => {
      const name = rule.name.trim();
      const content = rule.content.trim();
      parts.push(name ? `## ${name}\n${content}` : content);
    });
  }

  return parts.join('\n\n');
}
