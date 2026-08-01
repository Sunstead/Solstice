import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';

// True if any selection range overlaps [from, to] (touching counts).
function cursorOverlaps(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

class TaskCheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private charPos: number) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.charPos === this.charPos;
  }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-checkbox';
    input.checked = this.checked;
    input.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: {
          from: this.charPos,
          to: this.charPos + 1,
          insert: this.checked ? ' ' : 'x',
        },
      });
    });
    return input;
  }
  ignoreEvent() {
    return false;
  }
}

// Renders a bullet-list ListMark ("-", "*", "+") as a bullet glyph, and an
// ordered-list ListMark ("1.", "2)") as its own typed number/delimiter —
// shadcn relies on native ::marker for both, which we can't use without a
// real <li>, so this widget is the inline substitute for that marker box.
class ListMarkerWidget extends WidgetType {
  constructor(private ordered: boolean, private text: string, private depth: number) {
    super();
  }
  eq(other: ListMarkerWidget) {
    return (
      other.ordered === this.ordered &&
      other.text === this.text &&
      other.depth === this.depth
    );
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.ordered ? 'cm-list-marker cm-list-marker-ordered' : 'cm-list-marker cm-list-marker-bullet';
    span.setAttribute('data-depth', String(this.depth));
    if (this.ordered) {
      span.textContent = this.text;
    } else {
      // Match shadcn's disc / circle / square rotation (ul: disc,
      // ul ul: circle, ul ul ul+: square). depth is 1-indexed (a
      // top-level list is depth 1), so index by depth - 1.
      const glyphs = ['\u2022', '\u25E6', '\u25AA'];
      span.textContent = glyphs[Math.min(this.depth - 1, glyphs.length - 1)];
    }
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

// Depth of a ListItem = number of BulletList/OrderedList ancestors above
// it (1 = top-level list). Used both for marker glyph rotation and for
// indent width, since without a real <ul> there's no browser-native
// nested indent to inherit.
function listDepth(node: { name: string; parent: any }): number {
  let depth = 0;
  let cur = node.parent;
  while (cur) {
    if (cur.name === 'BulletList' || cur.name === 'OrderedList') depth++;
    cur = cur.parent;
  }
  return depth;
}

// Maps a top-level block node name to the CSS class that carries its
// "space above" value (see cm-typeset.css). Only nodes that shadcn's
// typeset gives a margin-block-start to are listed here.
function blockClassFor(name: string): string | null {
  if (name === 'Paragraph') return 'cm-block-p';
  if (name.startsWith('ATXHeading')) {
    const level = name.slice('ATXHeading'.length);
    return `cm-block-h${level}`;
  }
  if (name === 'Blockquote') return 'cm-block-blockquote';
  if (name === 'BulletList' || name === 'OrderedList') return 'cm-block-list';
  if (name === 'FencedCode' || name === 'CodeBlock') return 'cm-block-pre';
  if (name === 'HorizontalRule') return 'cm-block-hr';
  return null;
}

// Node names that count as "a heading" for the purpose of the
// "heading owns the space below it" rule (shadcn: h1+*, h2+*, ... { margin-block-start: 1em }).
function isHeadingName(name: string): boolean {
  return name.startsWith('ATXHeading');
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const { name } = node;

        // Headings
        if (name.startsWith('ATXHeading')) {
          const level = name.slice('ATXHeading'.length);
          ranges.push(
            Decoration.mark({ class: `cm-heading-${level}` }).range(node.from, node.to),
          );
          const marker = node.node.getChild('HeaderMark');
          if (marker && !cursorOverlaps(state, node.from, node.to)) {
            ranges.push(Decoration.replace({}).range(marker.from, marker.to + 1));
          }
          return;
        }

        // Bold
        if (name === 'StrongEmphasis') {
          ranges.push(Decoration.mark({ tagName: 'strong' }).range(node.from, node.to));
          if (!cursorOverlaps(state, node.from, node.to)) {
            for (const mark of node.node.getChildren('EmphasisMark')) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
          }
          return;
        }

        // Italic
        if (name === 'Emphasis') {
          ranges.push(Decoration.mark({ tagName: 'em' }).range(node.from, node.to));
          if (!cursorOverlaps(state, node.from, node.to)) {
            for (const mark of node.node.getChildren('EmphasisMark')) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
          }
          return;
        }

        // Strikethrough (GFM)
        if (name === 'Strikethrough') {
          ranges.push(Decoration.mark({ tagName: 's' }).range(node.from, node.to));
          if (!cursorOverlaps(state, node.from, node.to)) {
            for (const mark of node.node.getChildren('StrikethroughMark')) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
          }
          return;
        }

        // Inline code
        if (name === 'InlineCode') {
          ranges.push(Decoration.mark({ tagName: 'code' }).range(node.from, node.to));
          if (!cursorOverlaps(state, node.from, node.to)) {
            for (const mark of node.node.getChildren('CodeMark')) {
              ranges.push(Decoration.replace({}).range(mark.from, mark.to));
            }
          }
          return;
        }

        // Links: [text](url) -> render as <a>text</a>, raw source shown while focused
        if (name === 'Link') {
          if (cursorOverlaps(state, node.from, node.to)) return;

          ranges.push(Decoration.mark({ tagName: 'a' }).range(node.from, node.to));
          for (const mark of node.node.getChildren('LinkMark')) {
            ranges.push(Decoration.replace({}).range(mark.from, mark.to));
          }
          const urlNode = node.node.getChild('URL');
          if (urlNode) {
            ranges.push(Decoration.replace({}).range(urlNode.from, urlNode.to));
          }
          return;
        }

        // GFM task checkboxes
        if (name === 'TaskMarker') {
          if (cursorOverlaps(state, node.from, node.to)) return;

          const checked = state.doc.sliceString(node.from, node.to).includes('x');
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked, node.from + 1),
            }).range(node.from, node.to),
          );
          return;
        }

        // List item markers ("-", "*", "+", "1.", "2)").
        // Skipped when the marker contains a TaskMarker child (GFM task
        // list item) since TaskCheckboxWidget above already replaces that
        // whole span with the checkbox — rendering a bullet here too would
        // double up. Also skipped while the cursor is anywhere on this
        // item's own line, so editing the marker/text shows raw source
        // (matches the heading/emphasis/link cursor behavior elsewhere
        // in this file).
        if (name === 'ListMark') {
          const parent = node.node.parent;
          if (!parent || parent.name !== 'ListItem') return;
          if (node.node.getChild('TaskMarker')) return;

          const line = state.doc.lineAt(node.from);
          if (cursorOverlaps(state, line.from, line.to)) return;

          const grandparent = parent.parent;
          const ordered = grandparent?.name === 'OrderedList';
          const depth = listDepth(parent);
          const text = state.doc.sliceString(node.from, node.to);

          ranges.push(
            Decoration.replace({
              widget: new ListMarkerWidget(ordered, text, depth),
            }).range(node.from, node.to),
          );
          return;
        }
      },
    });
  }

  // ---- Block separation pass ----
  // Mirrors shadcn/typeset's block-level margin-block-start rhythm, but as
  // padding-block-start on a Decoration.line applied to each top-level
  // block's first line. Margins don't compose reliably with CodeMirror's
  // per-line box model (see cm-typeset.css header comment), so padding on
  // the line element is the correct primitive here.
  //
  // Only walks TOP-LEVEL block children of Document, matching shadcn's
  // default flow spacing between siblings. Nested block rhythm (list
  // items, blockquote contents) is intentionally out of scope for this
  // pass -- see note in cm-typeset.css.
  const tree = syntaxTree(state);
  const doc = tree.topNode;
  let prevBlockName: string | null = null;
  let isFirstBlock = true;

  for (let child = doc.firstChild; child; child = child.nextSibling) {
    const cls = blockClassFor(child.name);
    if (!cls) {
      prevBlockName = child.name;
      continue;
    }

    // Skip decorating blocks entirely outside the visible range, but still
    // track them for prevBlockName/isFirstBlock bookkeeping so state stays
    // correct as the viewport scrolls.
    const inView = view.visibleRanges.some((r) => child.from <= r.to && child.to >= r.from);

    if (inView) {
      const line = state.doc.lineAt(child.from);
      const classes = [cls];

      // "First child gets no space above" (shadcn: .typeset > :first-child).
      if (isFirstBlock) {
        classes.push('cm-block-first');
      }
      // "Heading owns the space below it" (shadcn: h1+*, h2+*, ... ).
      if (prevBlockName && isHeadingName(prevBlockName)) {
        classes.push('cm-block-after-heading');
      }

      ranges.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
    }

    prevBlockName = child.name;
    isFirstBlock = false;
  }

  // ---- List indentation pass ----
  // Walks every ListItem (at any nesting depth) and line-decorates each of
  // ITS OWN lines with a depth class. Real <li> gets its hanging indent
  // for free from the browser; a .cm-line has no such thing, so
  // padding-inline-start here is what actually pushes wrapped content
  // under the marker. cm-list-item marks the item's first line (where the
  // marker widget sits) vs cm-list-continuation for any further lines of
  // the SAME item's own content, since the marker column only needs
  // reserving once.
  //
  // A ListItem's range includes any nested sub-list inside it, but those
  // lines belong to the nested ListItems and get decorated (at their own,
  // deeper depth) by this same walk when it reaches them -- so this only
  // decorates up to the start of the first nested list child, not the
  // item's full node range, to avoid stamping a shallower depth class on
  // top of a line a deeper item already owns.
  const MAX_LIST_DEPTH_CLASS = 4; // cm-typeset.css defines depth-1..4; deeper nests reuse depth-4's indent
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'ListItem') return;
      if (!view.visibleRanges.some((r) => node.from <= r.to && node.to >= r.from)) return;

      const nestedList = node.node.getChild('BulletList') ?? node.node.getChild('OrderedList');
      const ownEnd = nestedList ? nestedList.from : node.to;

      const depth = Math.min(listDepth(node.node), MAX_LIST_DEPTH_CLASS);
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(Math.max(node.from, ownEnd - 1)).number;

      for (let ln = startLine; ln <= endLine; ln++) {
        const line = state.doc.line(ln);
        const kind = ln === startLine ? 'cm-list-item' : 'cm-list-continuation';
        ranges.push(
          Decoration.line({ class: `${kind} cm-list-depth-${depth}` }).range(line.from),
        );
      }
    },
  });

  // Decoration.set requires input sorted by `from` (with a stable tiebreak
  // CodeMirror handles internally via each Decoration's own startSide).
  // The block-separation and list-indentation passes above append line
  // decorations after the inline pass has already run, so the combined
  // array needs re-sorting.
  ranges.sort((a, b) => a.from - b.from);

  return Decoration.set(ranges, true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);