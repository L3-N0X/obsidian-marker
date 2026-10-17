import type { ConversionResult } from '../converter';
import type { MarkerSettings } from '../settings';
import type { PreparedConversion } from './types';

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

export function safeRelativePath(path: string): string {
  const value = path.replace(/\\/g, '/');
  if (!value || value.startsWith('/') || hasControlCharacters(value) ||
      /^[a-z]:/i.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('Invalid output path');
  }
  return value;
}

const metadataKeys = ['languages', 'filetype', 'ocr_stats', 'block_stats', 'failed_pages',
  'pdf_bookmarks', 'pdf_bookmarks_truncated'];

export function inlineLinkTargets(markdown: string): string[] {
  const result: string[] = [];
  transformInlineLinks(markdown, (_original, _image, _label, src) => { result.push(src); return _original; });
  return result;
}

function transformInlineLinks(markdown: string, transform: (original: string, image: boolean, label: string, src: string, suffix: string, wrapped: boolean) => string): string {
  const pattern = /(!?)\[((?:\\.|[^\]\\])*)\]\(/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let result = '';
  while ((match = pattern.exec(markdown))) {
    let end = pattern.lastIndex;
    let depth = 1;
    let quote = '';
    let angle = false;
    for (; end < markdown.length; end++) {
      const char = markdown[end];
      if (char === '\\') { end++; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (angle) { if (char === '>') angle = false; continue; }
      if (char === '<') { angle = true; continue; }
      if ((char === '"' || char === "'") && /\s/.test(markdown[end - 1] || '')) { quote = char; continue; }
      if (char === '(') depth++;
      if (char === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    result += markdown.slice(cursor, match.index);
    const destination = markdown.slice(pattern.lastIndex, end).trim();
    const wrapped = destination.match(/^<([^>]+)>([\s\S]*)$/);
    const titled = destination.match(/^(.*?)(\s+["'][\s\S]*)$/);
    const src = wrapped ? wrapped[1] : titled ? titled[1] : destination;
    const suffix = wrapped ? wrapped[2] : titled ? titled[2] : '';
    result += transform(markdown.slice(match.index, end + 1), !!match[1], match[2], src, suffix, !!wrapped);
    cursor = end + 1; pattern.lastIndex = cursor;
  }
  result += markdown.slice(cursor);
  return result;
}

function rewriteMarkdownImages(markdown: string, rewrite: (src: string) => string, remove: boolean): string {
  let result = transformInlineLinks(markdown, (original, image, label, src, suffix, wrapped) => {
    if (!image) return original;
    if (remove) return '';
    return `![${label}](${wrapped ? '<' : ''}${rewrite(src)}${wrapped ? '>' : ''}${suffix})`;
  });
  result = result.replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    if (remove) return '';
    const separator = target.indexOf('|');
    const src = separator >= 0 ? target.slice(0, separator) : target;
    return `![[${rewrite(src)}${separator >= 0 ? target.slice(separator) : ''}]]`;
  });
  if (remove) result = result.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');
  else result = result.replace(/^(\s*\[[^\]]+\]:\s*)(<[^>]+>|\S+)(.*)$/gm,
    (_match, prefix: string, target: string, suffix: string) => {
      const wrapped = target.startsWith('<');
      return prefix + (wrapped ? '<' : '') + rewrite(wrapped ? target.slice(1, -1) : target) + (wrapped ? '>' : '') + suffix;
    });
  return result;
}

export function prepareArtifacts(
  data: ConversionResult, settings: MarkerSettings,
  original: { path: string; name: string; basename: string }, folder: string,
  yaml: { parse: (text: string) => any; stringify: (value: any) => string }
): PreparedConversion {
  if (!data.success) throw new Error(data.error || 'Extraction failed');
  const folderPath = safeRelativePath(folder.replace(/\/$/, '')) + '/';
  const result: PreparedConversion = {
    folderPath, originalPath: original.path, originalName: original.name, files: {},
    moveOriginal: settings.movePDFtoFolder, deleteOriginal: settings.deleteOriginal,
  };
  const images = settings.extractContent !== 'text' && !settings.disableImageExtraction ? data.images || {} : {};
  const imagePaths: Record<string, string> = Object.create(null);
  for (const [name, content] of Object.entries(images)) {
    const cleanName = safeRelativePath(name);
    const relative = settings.createAssetSubfolder ? `assets/${original.basename}_${cleanName}` : cleanName;
    imagePaths[name] = safeRelativePath(relative);
    result.files[folderPath + relative] = { content, binary: true };
  }
  const rewrite = (src: string): string => {
    let decoded = src;
    try { decoded = decodeURI(src); } catch { /* Keep literal paths. */ }
    const target = imagePaths[decoded] || imagePaths[src];
    return target ? target.replace(/ /g, '%20') : src;
  };
  if (settings.extractContent !== 'images' && data.markdown) {
    let markdown = rewriteMarkdownImages(data.markdown, rewrite, settings.extractContent === 'text' || !!settings.disableImageExtraction);
    if (settings.writeMetadata && data.metadata) {
      const metadata: Record<string, unknown> = {};
      for (const key of metadataKeys) {
        const value = data.metadata[key];
        if (value === undefined) continue;
        if ((key === 'ocr_stats' || key === 'block_stats') && value && typeof value === 'object') {
          Object.assign(metadata, value);
        } else metadata[key] = value;
      }
      const existing = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (existing) {
        const parsed = yaml.parse(existing[1]);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid extracted frontmatter');
        Object.assign(metadata, parsed);
        markdown = markdown.slice(existing[0].length);
      }
      if (Object.keys(metadata).length) markdown = `---\n${yaml.stringify(metadata).trimEnd()}\n---\n${markdown}`;
    }
    result.markdownPath = folderPath + safeRelativePath(original.basename + '.md');
    if (result.files[result.markdownPath]) throw new Error('Attachment collides with the Markdown output');
    result.files[result.markdownPath] = { content: markdown, binary: false };
    if (settings.backupRawExtraction) {
      // Keep the pre-formatting extraction next to the images. The .backup
      // extension keeps it out of Obsidian's index and out of the way.
      const backupPath = folderPath + safeRelativePath(`assets/${original.basename}.md.backup`);
      if (!result.files[backupPath]) result.files[backupPath] = { content: markdown, binary: false };
    }
  }
  if (settings.saveHtmlOutput && settings.extractContent !== 'images' && data.html) {
    let html = data.html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi,
      (_match, prefix: string, src: string, suffix: string) => prefix + rewrite(src) + suffix);
    if (settings.extractContent === 'text' || settings.disableImageExtraction) html = html.replace(/<img[^>]*>/gi, '');
    const path = folderPath + safeRelativePath(original.basename + '.html');
    if (result.files[path]) throw new Error('Attachment collides with the HTML output');
    result.files[path] = { content: html, binary: false };
  }
  if (!Object.keys(result.files).length) throw new Error('Extraction returned no requested content');
  return result;
}
