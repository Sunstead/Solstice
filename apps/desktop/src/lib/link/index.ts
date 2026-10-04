import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { MarkType } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $inputRule, $prose } from '@milkdown/kit/utils';
import { openUrl } from '@/lib/backend/shell';

import { attributeFromEvent } from '@/lib/editor/event-target';
import { getSetting } from '@/lib/settings/store';
import { useLinkEditor } from '@/lib/stores/link-editor';
import { isSafeExternalHref, isUrl, trimUrl } from './url';

const LINK_MARK = 'link';

function linkMarkType(state: EditorState): MarkType | null {
  return state.schema.marks[LINK_MARK] ?? null;
}

/** A contiguous stretch of text carrying one link. */
interface LinkRun {
  from: number;
  to: number;
  href: string;
}

/**
 * The link run containing `pos`, if any.
 *
 * One link can span several text nodes when another mark starts or stops
 * partway through it, so adjacent children sharing the same href are joined
 * into a single run before the caret is tested against it.
 */
function linkAt(state: EditorState, pos: number): LinkRun | null {
  const markType = linkMarkType(state);
  if (!markType) return null;

  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const blockStart = $pos.start();
  const runs: LinkRun[] = [];
  let open: LinkRun | null = null;

  parent.forEach((child, offset) => {
    const from = blockStart + offset;
    const to = from + child.nodeSize;
    const mark = markType.isInSet(child.marks);

    if (!mark) {
      open = null;
      return;
    }

    const href = String(mark.attrs.href ?? '');

    if (open && open.href === href && open.to === from) {
      open.to = to;
      return;
    }

    open = { from, to, href };
    runs.push(open);
  });

  return runs.find((run) => pos >= run.from && pos <= run.to) ?? null;
}

/**
 * Publishes the link under the caret so the floating editor can show it.
 * Detection lives here because only the plugin can see the selection; what to
 * draw is the store's business.
 */
const linkTracker = $prose(
  () =>
    new Plugin({
      key: new PluginKey('link-tracker'),
      view: () => ({
        update: (view) => {
          const { selection } = view.state;
          const found = selection.empty
            ? linkAt(view.state, selection.from)
            : null;

          const store = useLinkEditor.getState();

          if (!found) {
            if (store.target) store.hide();
            return;
          }

          if (
            store.target?.from === found.from &&
            store.target.to === found.to &&
            store.target.href === found.href
          ) {
            return;
          }

          const start = view.coordsAtPos(found.from);
          store.show({
            view,
            ...found,
            rect: { top: start.top, bottom: start.bottom, left: start.left },
          });
        },
        destroy: () => useLinkEditor.getState().hide(),
      }),
      props: {
        handleDOMEvents: {
          // Paired with the click handler for the same reason the wikilink
          // plugin pairs them: without this the caret jumps before the click
          // is delivered.
          mousedown: (_view, event) => {
            if (!isModifiedClick(event)) return false;
            return anchorHref(event) !== null;
          },
          click: (_view, event) => {
            if (!isModifiedClick(event)) return false;

            const href = anchorHref(event);
            if (href === null) return false;
            if (!getSetting('links.openExternalInBrowser')) return false;
            if (!isSafeExternalHref(href)) return false;

            event.preventDefault();
            void openUrl(href);
            return true;
          },
        },
      },
    }),
);

/** Cmd/Ctrl-click opens; a plain click still places the caret for editing. */
function isModifiedClick(event: MouseEvent): boolean {
  return event.button === 0 && (event.metaKey || event.ctrlKey);
}

function anchorHref(event: MouseEvent): string | null {
  return attributeFromEvent(event, 'a[href]', 'href');
}

/**
 * A URL followed by a space becomes a link. GFM already autolinks bare URLs
 * when a file is read from disk, so this only covers the live-typing case --
 * the two have to agree or text would change shape on reload.
 */
const autolink = $inputRule(
  () =>
    new InputRule(
      /(?:^|\s)((?:https?:\/\/|mailto:)[^\s<>]+)(\s)$/,
      (state, match, _start, end) => {
        const markType = linkMarkType(state);
        if (!markType) return null;

        const url = trimUrl(match[1]);
        if (!url) return null;

        // `start` covers whatever the pattern matched, including the leading
        // separator; the link itself begins where the URL does.
        const urlStart = end - match[1].length;
        if (markType.isInSet(state.doc.resolve(urlStart).marks())) return null;

        const tr = state.tr;
        tr.insertText(match[2], end);
        tr.addMark(urlStart, urlStart + url.length, markType.create({ href: url }));

        return tr;
      },
    ),
);

/**
 * Pasting a URL over a selection links the selection instead of replacing it.
 * Anything else falls through to the clipboard plugin untouched.
 */
const pasteLink = $prose(
  () =>
    new Plugin({
      key: new PluginKey('link-paste'),
      props: {
        handlePaste: (view: EditorView, event: ClipboardEvent) => {
          const { selection } = view.state;
          if (selection.empty) return false;

          const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
          if (!isUrl(text)) return false;

          const markType = linkMarkType(view.state);
          if (!markType) return false;

          event.preventDefault();
          view.dispatch(
            view.state.tr.addMark(
              selection.from,
              selection.to,
              markType.create({ href: trimUrl(text) }),
            ),
          );
          return true;
        },
      },
    }),
);

export const link: MilkdownPlugin[] = [linkTracker, autolink, pasteLink].flat();
