import { highlightCode, classHighlighter } from '@lezer/highlight';
import katexCss from 'katex/dist/katex.min.css?inline';

import exportCss from '@/styles/export.css?inline';
import { useWorkspace } from '@/hooks/use-workspace';
import { loadLanguage } from '@/lib/codeblock/languages';
import { renderMarkdownFragment } from '@/lib/editor/static-markdown';
import { loadEmbedSource } from '@/lib/embed/source';
import { resolveAsset } from '@/lib/image/resolve';
import { renderMath } from '@/lib/math/render';
import { inlineCssUrls, type ExportSources } from './document';

/** The app's own renderer, notes, KaTeX and grammars, for `noteBody`. */
export const appSources: ExportSources = {
  render: (markdown, sourcePath) =>
    renderMarkdownFragment(markdown, { sourcePath, workspaceRoot: useWorkspace.getState().path }),
  read: loadEmbedSource,
  resolve: (target, sourcePath) => {
    const asset = resolveAsset(target, { notePath: sourcePath, workspaceRoot: useWorkspace.getState().path });
    return asset.status === 'resolved' ? { absolutePath: asset.absolutePath, url: asset.url } : null;
  },
  // A picture on the web that won't come (CORS) keeps its address: the page
  // can still load it while it prints.
  dataUrl: async (url) => (await dataUrl(url)) ?? (/^https?:/i.test(url) ? url : null),
  math: renderMath,
  highlight: async (code, language) => {
    const support = await loadLanguage(language);
    if (!support) return null;
    const out = document.createElement('div');
    highlightCode(
      code,
      support.language.parser.parse(code),
      classHighlighter,
      (text, classes) => {
        const node = classes ? Object.assign(document.createElement('span'), { className: classes }) : null;
        if (node) node.textContent = text;
        out.append(node ?? document.createTextNode(text));
      },
      () => out.append(document.createTextNode('\n')),
    );
    return out.innerHTML;
  },
};

export async function dataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

let css: Promise<string> | null = null;

/**
 * The export stylesheet with KaTeX's, its fonts inside it (only woff2, which
 * every webview reads). Built once.
 */
export function exportStylesheet(): Promise<string> {
  css ??= inlineCssUrls(
    katexCss.replace(/,\s*url\([^)]*\)\s*format\(["'](?:woff|truetype)["']\)/g, ''),
    (url) => dataUrl(new URL(url, location.href).href),
  )
    .then((katex) => `${katex}\n${exportCss}`)
    .catch((error: unknown) => {
      css = null;
      throw error;
    });
  return css;
}

/**
 * The editor's typography settings, as `apply.ts` put them on `<html>`, and
 * the app's own font beneath them (`--export-font-ui`).
 */
export function editorVars(): Record<string, string> {
  const style = document.documentElement.style;
  const vars: Record<string, string> = { '--export-font-ui': getComputedStyle(document.body).fontFamily };
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name.startsWith('--editor-')) vars[name] = style.getPropertyValue(name).trim();
  }
  return vars;
}

/**
 * The `@font-face` rules the app has for the families in `vars` (Geist, a
 * bundled editor font), their files inside them, so the page has them too.
 * Installed fonts need nothing: the page's system has them.
 */
export async function fontFaces(vars: Record<string, string>): Promise<string> {
  const families = new Set(
    Object.values(vars)
      .flatMap((value) => value.split(','))
      .map((family) => family.trim().replace(/^["']|["']$/g, '').toLowerCase())
      .filter(Boolean),
  );
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // Another origin's sheet keeps its rules to itself.
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (families.has(family)) rules.push(rule.cssText);
    }
  }
  return inlineCssUrls(rules.join('\n'), (url) => dataUrl(new URL(url, location.href).href));
}
