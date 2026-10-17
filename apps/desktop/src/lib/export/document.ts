import { calloutIcon } from '@/lib/callout/icons';
import { parseCallout } from '@/lib/callout/types';
import { sliceBlock, sliceSection } from '@/lib/embed/source';
import { embedKind } from '@/lib/embed/kind';
import { splitFrontMatter } from '@/lib/frontmatter/split';
import { parseSize } from '@/lib/image/size';
import { basename, parseWikilinkTarget } from '@/lib/wikilink/target';

/**
 * A note as a page of its own, for a PDF: rendered as the editor shows it
 * read-only (`renderMarkdownFragment`), with what the editor draws live --
 * embeds, math, highlighted code -- drawn in, and every image put inside the
 * page, so the HTML needs nothing else to print. The platform turns it into
 * pages (`renderPdf`).
 *
 * What it reads and draws with comes in as `ExportSources`, so this stays
 * plain DOM work (`sources.ts` is the app's).
 */
export type ExportSources = {
  /** Markdown to DOM, comments dropped and links resolved against `sourcePath`. */
  render(markdown: string, sourcePath: string): Promise<DocumentFragment | null>;
  read(path: string): Promise<string | null>;
  resolve(target: string, sourcePath: string): { absolutePath: string; url: string } | null;
  /** An image as a `data:` URL; null if it can't be read. */
  dataUrl(url: string): Promise<string | null>;
  math(source: string, display: boolean): string;
  /** Code as highlighted HTML, or null for a language it doesn't know. */
  highlight(code: string, language: string): Promise<string | null>;
};

export type PageSize = 'a4' | 'letter';

/** In points, as PDFs measure. */
export const PAGE_SIZES: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/**
 * A page to print on, in points: what the platform's PDF writer is given,
 * and the page's own `@page`.
 */
export type PageSpec = { width: number; height: number; margin: number };

/** A note's page: the paper, with margins of about 18mm. */
export function notePage(size: PageSize): PageSpec {
  return { ...PAGE_SIZES[size], margin: 50 };
}

/** The paper where the reader is: Letter in North America, A4 elsewhere. */
export function pageSizeFor(locale: string): PageSize {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  return region === 'US' || region === 'CA' || region === 'MX' ? 'letter' : 'a4';
}

/** As deep as embeds go in the editor (`MAX_EMBED_DEPTH`). */
const MAX_DEPTH = 4;

export async function noteBody(
  path: string,
  markdown: string,
  sources: ExportSources,
  doc: Document = document,
): Promise<HTMLElement> {
  const text = splitFrontMatter(markdown)?.body ?? markdown;
  const article = doc.createElement('article');
  article.className = 'typeset';

  if (!/^\s*#\s/.test(text) && !/^\s*[^\n]+\n=+[ \t]*(\n|$)/.test(text)) {
    const title = doc.createElement('h1');
    title.textContent = basename(path).replace(/\.md$/i, '');
    article.append(title);
  }

  const fragment = await sources.render(text, path);
  if (!fragment) throw new Error(`Couldn't render ${basename(path)}.`);
  await expandEmbeds(fragment, path, [path], sources, doc);
  article.append(fragment);

  drawCallouts(article);
  drawMath(article, sources);
  await highlightCode(article, sources);
  await inlineImages(article, sources);
  return article;
}

async function expandEmbeds(
  root: ParentNode,
  sourcePath: string,
  chain: string[],
  sources: ExportSources,
  doc: Document,
): Promise<void> {
  for (const embed of Array.from(root.querySelectorAll<HTMLElement>('span[data-wiki-embed]'))) {
    const value = embed.getAttribute('data-wiki-embed') ?? '';
    const parts = parseWikilinkTarget(value);
    const target = sources.resolve(parts.path, sourcePath);
    const named = () => embed.replaceWith(doc.createTextNode(parts.path || value));

    if (!target) {
      named();
      continue;
    }

    const kind = embedKind(target.absolutePath);
    if (kind === 'image') {
      const image = doc.createElement('img');
      image.src = target.url;
      image.alt = parts.path;
      const { width, height } = parseSize(parts.suffix);
      if (width !== null) image.setAttribute('width', String(width));
      if (height !== null) image.setAttribute('height', String(height));
      embed.replaceWith(image);
      continue;
    }

    if (kind !== 'markdown') {
      const file = doc.createElement('span');
      file.className = 'solstice-export-file';
      file.textContent = basename(target.absolutePath);
      embed.replaceWith(file);
      continue;
    }

    if (chain.includes(target.absolutePath) || chain.length >= MAX_DEPTH) {
      named();
      continue;
    }

    const markdown = await sources.read(target.absolutePath);
    const slice =
      markdown === null
        ? null
        : parts.heading !== null
          ? sliceSection(markdown, parts.heading)
          : parts.block !== null
            ? sliceBlock(markdown, parts.block)
            : (splitFrontMatter(markdown)?.body ?? markdown);
    const rendered = slice === null ? null : await sources.render(slice, target.absolutePath);
    if (!rendered) {
      named();
      continue;
    }
    await expandEmbeds(rendered, target.absolutePath, [...chain, target.absolutePath], sources, doc);

    const box = doc.createElement('div');
    box.className = 'solstice-export-embed';
    box.append(rendered);
    // A block can't sit inside a paragraph (the page's parser would split
    // it), so an embed alone on its line takes the paragraph's place; one
    // mid-sentence is shown by name.
    const paragraph = embed.parentElement;
    if (paragraph?.tagName === 'P' && paragraph.textContent?.trim() === '' && paragraph.childElementCount === 1) {
      paragraph.replaceWith(box);
    } else {
      named();
    }
  }
}

/**
 * `> [!kind] Title` as the editor draws it (by decorations there, so not in
 * the static render): the callout's class and kind, its icon for the marker,
 * the rest of the first line as its title. Folded ones print open.
 */
function drawCallouts(root: HTMLElement) {
  const doc = root.ownerDocument;
  for (const marker of Array.from(root.querySelectorAll<HTMLElement>('blockquote > p:first-child > [data-callout-marker]:first-child'))) {
    const callout = parseCallout(marker.textContent ?? '');
    const quote = marker.parentElement!.parentElement!;
    if (!callout) continue;
    quote.classList.add('callout');
    quote.setAttribute('data-callout', callout.type);

    // The title runs from the marker to the first line break, soft ones
    // included (`remarkLineBreak` makes them hardbreaks too).
    const title = doc.createElement('span');
    title.className = 'callout-title';
    let next = marker.nextSibling;
    while (next && next.nodeName !== 'BR' && (next as Element).getAttribute?.('data-type') !== 'hardbreak') {
      const moving = next;
      next = next.nextSibling;
      title.append(moving);
    }
    if (!title.textContent?.trim()) title.textContent = callout.type.charAt(0).toUpperCase() + callout.type.slice(1);
    marker.replaceWith(calloutIcon(callout.type), title);
  }
}

function drawMath(root: HTMLElement, sources: ExportSources) {
  for (const inline of Array.from(root.querySelectorAll<HTMLElement>('span[data-math-inline]'))) {
    const source = (inline.textContent ?? '').replace(/^\$/, '').replace(/\$$/, '');
    const rendered = root.ownerDocument.createElement('span');
    rendered.className = 'math-inline-rendered';
    rendered.innerHTML = sources.math(source, false);
    inline.replaceWith(rendered);
  }
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('div[data-math-block]'))) {
    const rendered = root.ownerDocument.createElement('div');
    rendered.className = 'math-block-rendered';
    rendered.innerHTML = sources.math(block.getAttribute('data-math-block') ?? '', true);
    block.replaceWith(rendered);
  }
}

async function highlightCode(root: HTMLElement, sources: ExportSources) {
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>('pre[data-language]'))) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const html = await sources.highlight(code.textContent ?? '', pre.getAttribute('data-language') ?? '');
    if (html !== null) code.innerHTML = html;
  }
}

async function inlineImages(root: HTMLElement, sources: ExportSources) {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    const data = src && !src.startsWith('data:') ? await sources.dataUrl(src) : src;
    if (data) image.setAttribute('src', data);
    else image.replaceWith(root.ownerDocument.createTextNode(image.alt));
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The whole page. `vars` are the editor's typography settings (`--editor-*`),
 * so the PDF reads like the note.
 */
export function exportHtml(options: {
  title: string;
  body: string;
  css: string;
  page: PageSpec;
  vars: Record<string, string>;
}): string {
  const { width, height, margin } = options.page;
  const vars = Object.entries(options.vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  return `<!doctype html>
<html lang="${escapeHtml(document.documentElement.lang || 'en')}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<style>
@page { size: ${width}pt ${height}pt; margin: ${margin}pt; }
:root { ${vars} }
${options.css}
</style>
</head>
<body>
${options.body}
</body>
</html>
`;
}

/**
 * Puts what a stylesheet's `url()`s point at (KaTeX's fonts) into it, so the
 * page needs nothing from the app. A url it can't fetch is left as it was.
 */
export async function inlineCssUrls(css: string, fetchData: (url: string) => Promise<string | null>): Promise<string> {
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const urls = new Set<string>();
  for (const match of css.matchAll(pattern)) if (!match[2].startsWith('data:')) urls.add(match[2]);
  const data = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      const fetched = await fetchData(url);
      if (fetched) data.set(url, fetched);
    }),
  );
  return css.replace(pattern, (whole, _quote: string, url: string) =>
    data.has(url) ? `url("${data.get(url)}")` : whole,
  );
}
