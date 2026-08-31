import { imageAttr, imageSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { $inputRule } from '@milkdown/kit/utils';

import { joinAltSize, splitAltSize } from './size';

function numberAttribute(dom: HTMLElement, name: string): number | null {
  const raw = dom.getAttribute(name);
  if (raw === null) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The preset's image node, taught to carry a display size.
 *
 * The size lives in the alt text on disk (see `./size`), so this only has to
 * split it apart on parse and put it back on serialize -- the markdown itself
 * is unchanged, and an editor without this extension still sees a valid image.
 *
 * `parseDOM` reads `width`/`height` too, which is what makes a pasted HTML
 * `<img width="400">` arrive with its size intact.
 */
export const imageWithSize = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);

  return {
    ...base,
    attrs: {
      ...base.attrs,
      width: { default: null, validate: 'number|null' },
      height: { default: null, validate: 'number|null' },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom: HTMLElement | string) => {
          const element = dom as HTMLElement;
          return {
            src: element.getAttribute('src') || '',
            alt: element.getAttribute('alt') || '',
            title: element.getAttribute('title') || element.getAttribute('alt') || '',
            width: numberAttribute(element, 'width'),
            height: numberAttribute(element, 'height'),
          };
        },
      },
    ],
    // Nulls have to be filtered rather than spread: the preset spreads
    // `node.attrs` wholesale, which would emit `width="null"`.
    toDOM: (node) => {
      const { width, height, ...rest } = node.attrs;

      return [
        'img',
        {
          ...ctx.get(imageAttr.key)(node),
          ...rest,
          ...(width === null ? {} : { width: String(width) }),
          ...(height === null ? {} : { height: String(height) }),
        },
      ];
    },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        const { alt, width, height } = splitAltSize(String(node.alt ?? ''));

        state.addNode(type, {
          src: node.url,
          alt,
          title: node.title,
          width,
          height,
        });
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode('image', undefined, undefined, {
          title: node.attrs.title,
          url: node.attrs.src,
          alt: joinAltSize(node.attrs.alt, node.attrs.width, node.attrs.height),
        });
      },
    },
  };
});

/**
 * Makes `![alt](src)` become an image as it is typed.
 *
 * The preset defines an equivalent rule but never registers it -- its
 * `inputRules` array omits it -- so without this an image only appears after
 * the file is reparsed. The pattern is the preset's; the size split is ours.
 */
export const insertImageWithSizeInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /!\[(?<alt>.*?)]\((?<filename>.*?)\s*(?="|\))"?(?<title>[^"]+)?"?\)/,
      (state, match, start, end) => {
        const [matched, rawAlt = '', src = '', title = ''] = match;
        if (!matched) return null;

        const { alt, width, height } = splitAltSize(rawAlt);

        return state.tr.replaceWith(
          start,
          end,
          imageWithSize.type(ctx).create({ src, alt, title, width, height }),
        );
      },
    ),
);
