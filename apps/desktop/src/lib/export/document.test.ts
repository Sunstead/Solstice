// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { exportHtml, inlineCssUrls, noteBody, notePage, pageSizeFor, PAGE_SIZES, type ExportSources } from './document';

/**
 * A stand-in renderer: `# x` lines become headings, the rest is taken as
 * HTML, which is all these tests need of Markdown.
 */
function sources(files: Record<string, string> = {}, overrides: Partial<ExportSources> = {}): ExportSources {
  return {
    render: async (markdown) => {
      const html = markdown
        .split('\n')
        .map((line) => (line.startsWith('# ') ? `<h1>${line.slice(2)}</h1>` : line))
        .join('\n');
      return document.createRange().createContextualFragment(html);
    },
    read: async (path) => files[path] ?? null,
    resolve: (target) => {
      const path = `/w/${target.includes('.') ? target : `${target}.md`}`;
      return path in files || target.endsWith('.png') ? { absolutePath: path, url: `asset://${path}` } : null;
    },
    dataUrl: async (url) => `data:image/png;base64,${btoa(url)}`,
    math: (source, display) => `<katex display="${display}">${source}</katex>`,
    highlight: async (code, language) => (language === 'js' ? `<span class="tok-keyword">${code}</span>` : null),
    ...overrides,
  };
}

const body = async (markdown: string, s = sources()) => (await noteBody('/w/Plan.md', markdown, s)).innerHTML;

describe('noteBody', () => {
  it('leaves front matter out, and titles a note that has no heading of its own', async () => {
    const html = await body('---\ntags: [a]\n---\n<p>Hello</p>');
    expect(html).not.toContain('tags');
    expect(html).toMatch(/^<h1[^>]*>Plan<\/h1>/);
    expect(html).toContain('<p>Hello</p>');
  });

  it('keeps a note’s own first heading as its title', async () => {
    const html = await body('---\na: 1\n---\n\n# Real title\n<p>Hi</p>');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Real title');
  });

  it('renders math, inline and as a block', async () => {
    const html = await body('<p>Area <span data-math-inline="">$\\pi r^2$</span></p><div data-math-block="E = mc^2"></div>');
    expect(html).toContain('<katex display="false">\\pi r^2</katex>');
    expect(html).toContain('<katex display="true">E = mc^2</katex>');
    expect(html).not.toContain('$');
  });

  it('highlights code in a language it knows and leaves the rest plain', async () => {
    const html = await body('<pre data-language="js"><code>let x</code></pre><pre data-language="zz"><code>a &lt; b</code></pre>');
    expect(html).toContain('<code><span class="tok-keyword">let x</span></code>');
    expect(html).toContain('<code>a &lt; b</code>');
  });

  it('puts every image in the page itself', async () => {
    const html = await body('<p><img src="asset:///w/a.png"></p>');
    expect(html).toContain(`src="data:image/png;base64,${btoa('asset:///w/a.png')}"`);
  });

  it('drops an image it cannot read, keeping what it was of', async () => {
    const html = await body('<p><img src="asset:///gone.png" alt="Gone"></p>', sources({}, { dataUrl: async () => null }));
    expect(html).not.toContain('<img');
    expect(html).toContain('Gone');
  });

  it('writes an embedded note out in place of its paragraph', async () => {
    const html = await body('<p><span data-wiki-embed="Other"></span></p>', sources({ '/w/Other.md': '<p>From other</p>' }));
    expect(html).toMatch(/<div class="solstice-export-embed"><p>From other<\/p><\/div>/);
    expect(html).not.toContain('data-wiki-embed');
  });

  it('embeds only the section or block asked for', async () => {
    const files = { '/w/Other.md': '# One\n<p>first</p>\n# Two\n<p>second</p>' };
    const html = await body('<p><span data-wiki-embed="Other#Two"></span></p>', sources(files));
    expect(html).toContain('second');
    expect(html).not.toContain('first');
  });

  it('stops at an embed of a note already being embedded, and at depth', async () => {
    const files = { '/w/A.md': '<p>a <span data-wiki-embed="B"></span></p><p><span data-wiki-embed="B"></span></p>', '/w/B.md': '<p><span data-wiki-embed="A"></span></p>' };
    const html = await body('<p><span data-wiki-embed="A"></span></p>', sources(files));
    expect(html.match(/solstice-export-embed/g)!.length).toBeLessThanOrEqual(4);
    expect(html).toContain('A'); // the cycle shows as its target's name
  });

  it('shows an image embed, and names a file it cannot show', async () => {
    const html = await body('<p><span data-wiki-embed="pic.png|200"></span> and <span data-wiki-embed="Missing"></span></p>');
    expect(html).toMatch(/<img[^>]+src="data:image\/png;base64,[^"]+"[^>]+width="200"/);
    expect(html).toContain('Missing');
  });
});

describe('callouts', () => {
  it('draws a callout as the editor does: its kind, icon and title', async () => {
    const html = await body('<blockquote><p><span data-callout-marker="">[!warning]</span> Mind the gap<br>Body line</p></blockquote>');
    expect(html).toMatch(/<blockquote class="callout" data-callout="warning">/);
    expect(html).toContain('<svg');
    expect(html).toMatch(/<span class="callout-title">\s*Mind the gap<\/span>/);
    expect(html).not.toContain('[!warning]');
    expect(html).toContain('Body line');
  });

  it('ends the title at a soft line break too', async () => {
    const html = await body('<blockquote><p><span data-callout-marker="">[!note]</span> Title<span data-type="hardbreak" data-is-inline="true"> </span>Body</p></blockquote>');
    expect(html).toMatch(/<span class="callout-title"> Title<\/span><span data-type="hardbreak"/);
  });

  it('titles an untitled callout by its kind, and opens a folded one', async () => {
    const html = await body('<blockquote><p><span data-callout-marker="">[!tip]-</span></p><p>Hidden body</p></blockquote>');
    expect(html).toContain('<span class="callout-title">Tip</span>');
    expect(html).not.toContain('is-folded');
    expect(html).toContain('Hidden body');
  });

  it('leaves a plain quote alone', async () => {
    expect(await body('<blockquote><p>Just a quote</p></blockquote>')).toContain('<blockquote><p>Just a quote</p></blockquote>');
  });
});

describe('pageSizeFor', () => {
  it('is Letter in North America and A4 elsewhere', () => {
    expect(pageSizeFor('en-US')).toBe('letter');
    expect(pageSizeFor('fr-CA')).toBe('letter');
    expect(pageSizeFor('es-MX')).toBe('letter');
    expect(pageSizeFor('en-GB')).toBe('a4');
    expect(pageSizeFor('de')).toBe('a4');
    expect(PAGE_SIZES.a4.width).toBeCloseTo(595.28);
  });
});

describe('exportHtml', () => {
  it('is a standalone page with its size, styles and title', () => {
    const html = exportHtml({ title: 'Plan & <Co>', body: '<article>x</article>', css: '.a{}', page: notePage('letter'), vars: { '--editor-font-body': 'Georgia' } });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Plan &amp; &lt;Co&gt;</title>');
    expect(html).toContain('size: 612pt 792pt; margin: 50pt');
    expect(html).toContain('--editor-font-body: Georgia;');
    expect(html).toContain('.a{}');
    expect(html).toContain('<article>x</article>');
  });
});

describe('inlineCssUrls', () => {
  it('replaces each url() with its data, once per url', async () => {
    const fetchData = vi.fn(async (url: string) => `data:font/woff2;base64,${btoa(url)}`);
    const css = '@font-face{src:url(/a.woff2) format("woff2"),url("/a.woff") format("woff")}.b{background:url(/a.woff2)}';
    const out = await inlineCssUrls(css, fetchData);
    expect(out).not.toContain('url(/a.woff2)');
    expect(out).toContain(`url("data:font/woff2;base64,${btoa('/a.woff2')}")`);
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('leaves data: urls and ones it cannot fetch alone', async () => {
    const css = '.a{src:url(data:x)}.b{src:url(/gone)}';
    expect(await inlineCssUrls(css, async () => null)).toBe(css);
  });
});
