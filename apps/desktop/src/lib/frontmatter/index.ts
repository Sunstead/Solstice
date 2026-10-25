import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';

import { nativePickers } from '@/lib/backend/native';
import { can } from '@/lib/backend/platform';
import { findDate, withDate } from './dates';
import { frontMatterYaml, splitFrontMatter } from './split';

export const FRONTMATTER_MDAST_TYPE = 'solsticeFrontmatter';
export const FRONTMATTER_NODE_TYPE = 'frontmatter';

const ATTRIBUTE = 'data-frontmatter';

interface MdastRoot {
  type: string;
  children: unknown[];
}

type Parse = (doc: string, file?: unknown) => MdastRoot;

interface FrontmatterMdast {
  type: string;
  value: string;
  blank?: boolean;
}

const toMarkdownExtension = {
  handlers: {
    [FRONTMATTER_MDAST_TYPE]: (node: FrontmatterMdast) => node.value,
  },
  // Obsidian writes no blank line after the closing fence; keep whichever the
  // note had.
  join: [
    (left: FrontmatterMdast) =>
      left.type === FRONTMATTER_MDAST_TYPE ? (left.blank ? 1 : 0) : undefined,
  ],
};

/**
 * Front matter is only ever the start of the file, so it's split off before
 * micromark sees it rather than tokenized: otherwise `---` is a thematic break
 * and the YAML above the closing fence a setext heading.
 */
function remarkFrontmatter(this: { parser?: unknown; data(): unknown }) {
  const data = this.data() as { toMarkdownExtensions?: unknown[] };
  (data.toMarkdownExtensions ??= []).push(toMarkdownExtension);

  // remark-parse is attached first (Milkdown's `remarkCtx`), so this wraps it.
  const parse = this.parser as Parse | undefined;
  if (!parse) return;
  this.parser = ((doc, file) => {
    const split = splitFrontMatter(doc);
    if (!split) return parse(doc, file);
    // Blanked rather than cut, so every node keeps the file's offsets:
    // commonmark's marker plugin reads `*` or `_` from the source by them.
    const blanked = doc.slice(0, split.length).replace(/[^\n]/g, ' ') + doc.slice(split.length);
    const tree = parse(blanked, file);
    tree.children.unshift({
      type: FRONTMATTER_MDAST_TYPE,
      value: split.block,
      blank: split.blank,
    } satisfies FrontmatterMdast);
    return tree;
  }) satisfies Parse;
}

export const remarkFrontmatterPlugin = $remark('solsticeFrontmatter', () => remarkFrontmatter);

/** Top-level keys, for the collapsed summary. */
function keysOf(yaml: string): string[] {
  return [...yaml.matchAll(/^([^\s#-][^:\n]*?):(?:\s|$)/gm)].map((m) => m[1]);
}

/**
 * The whole block, fences included, is one attribute, so the round trip is
 * exact by construction. Read-only here; source mode edits it.
 */
export const frontmatterSchema = $nodeSchema(FRONTMATTER_NODE_TYPE, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  defining: true,
  isolating: true,
  attrs: {
    value: { default: '---\n---', validate: 'string' },
    blank: { default: true, validate: 'boolean' },
  },
  parseDOM: [
    {
      tag: `details[${ATTRIBUTE}]`,
      getAttrs: (dom: HTMLElement | string) => ({
        value: (dom as HTMLElement).getAttribute(ATTRIBUTE) || '---\n---',
      }),
    },
  ],
  toDOM: (node) => {
    const yaml = frontMatterYaml(node.attrs.value);
    return [
      'details',
      { [ATTRIBUTE]: node.attrs.value, class: 'solstice-frontmatter' },
      ['summary', ['span', 'Properties'], ['span', { class: 'solstice-frontmatter-keys' }, keysOf(yaml).join(', ')]],
      ['pre', yaml],
    ];
  },
  parseMarkdown: {
    match: ({ type }) => type === FRONTMATTER_MDAST_TYPE,
    runner: (state, node, type) => {
      state.addNode(type, {
        value: String(node.value ?? ''),
        blank: node.blank !== false,
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === FRONTMATTER_NODE_TYPE,
    runner: (state, node) => {
      state.addNode(FRONTMATTER_MDAST_TYPE, undefined, undefined, {
        value: node.attrs.value,
        blank: node.attrs.blank,
      });
    },
  },
}));

/**
 * Anywhere but the top it would serialize as a thematic break and a heading.
 * So the first block wins and moves back to the top (text typed above it),
 * and any other (pasted from another note) becomes a YAML code block.
 */
const frontmatterPlacement = $prose((ctx) => {
  const type = frontmatterSchema.type(ctx);
  const codeBlock = codeBlockSchema.type(ctx);

  return new Plugin({
    key: new PluginKey('frontmatter-placement'),
    appendTransaction: (transactions, _old, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const found: { node: Node; pos: number; top: boolean }[] = [];
      state.doc.descendants((node, pos, parent) => {
        if (node.type === type) found.push({ node, pos, top: parent === state.doc });
        return !node.isTextblock;
      });
      if (found.length === 0 || (found.length === 1 && found[0].pos === 0)) return null;

      const keep = found.find((f) => f.top);
      const tr = state.tr;
      for (const f of [...found].reverse()) {
        if (f === keep) continue;
        const yaml = frontMatterYaml(f.node.attrs.value);
        tr.replaceWith(
          f.pos,
          f.pos + f.node.nodeSize,
          codeBlock.create({ language: 'yaml' }, yaml ? state.schema.text(yaml) : null),
        );
      }
      if (keep && keep.pos !== 0) {
        const from = tr.mapping.map(keep.pos);
        tr.delete(from, from + keep.node.nodeSize);
        tr.insert(0, keep.node);
      }
      return tr;
    },
  });
});

export const frontmatter: MilkdownPlugin[] = [
  remarkFrontmatterPlugin,
  frontmatterSchema,
  frontmatterPlacement,
].flat();

/**
 * The editor's view: `toDOM`'s `<details>`, with events kept from ProseMirror
 * so the summary toggles instead of selecting the node. In the iOS app a
 * date value is a button for the system's calendar (`pickDate`), which
 * writes the line back as it was written, changing nothing else.
 */
export const frontmatterView = $view(frontmatterSchema.node, (): NodeViewConstructor => (node, view, getPos) => {
  const dom = document.createElement('div');
  let current = node;

  const pick = async (index: number, button: HTMLElement) => {
    const found = findDate(current.attrs.value.split('\n')[index] ?? '');
    if (!found) return;
    const { x, y, width, height } = button.getBoundingClientRect();
    const parts = await nativePickers.date(found.parts, { x, y, width, height }).catch(() => null);
    const pos = getPos();
    if (!parts || pos === undefined || !view.editable) return;
    const value = withDate(current.attrs.value, index, parts);
    if (value !== current.attrs.value) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, value }));
  };

  /** The YAML, its date values buttons where they can be picked. */
  const body = (block: string) => {
    const pre = document.createElement('pre');
    const lines = block.split('\n').slice(1, -1);
    if (!can.nativeViews || !view.editable) {
      pre.textContent = lines.join('\n');
      return pre;
    }
    lines.forEach((line, i) => {
      if (i > 0) pre.append('\n');
      const found = findDate(line);
      if (!found) return pre.append(line);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'solstice-frontmatter-date';
      button.textContent = found.value;
      button.addEventListener('click', () => void pick(i + 1, button));
      pre.append(found.before, button, found.after);
    });
    return pre;
  };

  const render = (next: Node) => {
    current = next;
    const yaml = frontMatterYaml(next.attrs.value);
    const open = dom.querySelector('details')?.open ?? false;
    const details = document.createElement('details');
    details.className = 'solstice-frontmatter';
    details.open = open;
    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.textContent = 'Properties';
    const keys = document.createElement('span');
    keys.className = 'solstice-frontmatter-keys';
    keys.textContent = keysOf(yaml).join(', ');
    summary.append(label, keys);
    details.append(summary, body(next.attrs.value));
    dom.replaceChildren(details);
  };
  render(node);

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false;
      render(next);
      return true;
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
});
