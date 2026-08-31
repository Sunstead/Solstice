import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';

import { renderMath } from '@/lib/math/render';
import { cn } from '@/lib/utils';

/**
 * Display math: rendered by default, with its source revealed for editing when
 * you click it.
 *
 * Two things make this work, and it is broken without either:
 *
 *  - The `$view` registration marks events inside this node view as belonging
 *    to it (`stopEvent`). Otherwise ProseMirror handles the keystrokes typed
 *    into the textarea as well, and since clicking the formula selects the
 *    node, the first character typed *replaces* it -- the formula vanishes as
 *    you try to edit it.
 *  - Mousedown on the rendered output is prevented, so no NodeSelection is
 *    created in the first place and focus can move straight to the textarea.
 *    Handing focus over asynchronously left a window in which a keystroke
 *    still reached the document.
 *
 * The formula is a node attribute rather than node content, so editing is a
 * plain textarea writing one attribute -- there is no second document to keep
 * in sync, and no dependency on the CodeMirror node view.
 */
export const MathBlockView: React.FC = () => {
  const { node, setAttrs, selected, view, getPos } = useNodeViewContext();
  const value: string = node.attrs.value;

  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Layout effect, not a plain effect: the textarea has to hold focus before
  // the browser can deliver a keystroke anywhere else.
  useLayoutEffect(() => {
    if (!editing) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    // The end of the formula: where a click or a keyboard entry from below
    // both want to be, and only one arrow press from leaving downwards.
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editing]);

  // Reaching the node with the keyboard should open it too, not just clicking.
  useEffect(() => {
    if (selected) setEditing(true);
  }, [selected]);

  /**
   * Moves the selection out of the formula and back into the document.
   *
   * If there is nothing on that side to move to -- the formula opens or closes
   * the document -- an empty paragraph is created, because a block the caret
   * cannot get past is a trap however it is entered.
   */
  const exitTo = (direction: -1 | 1) => {
    const pos = getPos();
    if (pos === undefined) return;

    setEditing(false);

    const { state } = view;
    const boundary = direction < 0 ? pos : pos + node.nodeSize;
    const near = Selection.near(state.doc.resolve(boundary), direction);

    // `Selection.near` falls back to the node itself when it cannot find a
    // text position, which would land us straight back inside.
    const escaped = near.from < pos || near.from > pos + node.nodeSize;

    if (escaped) {
      view.dispatch(state.tr.setSelection(near).scrollIntoView());
      view.focus();
      return;
    }

    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return;

    const tr = state.tr.insert(boundary, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  const closeAndReturnFocus = () => exitTo(1);

  return (
    <div
      className={cn(
        'solstice-math-block',
        editing && 'is-editing',
        selected && 'is-selected',
      )}
      contentEditable={false}
    >
      <div
        className='solstice-math-block-render'
        role='button'
        tabIndex={-1}
        title='Click to edit'
        onMouseDown={(event) => {
          event.preventDefault();
          setEditing(true);
        }}
        dangerouslySetInnerHTML={{ __html: renderMath(value, true) }}
      />

      {editing && (
        <textarea
          ref={textareaRef}
          data-not-typeset
          className='solstice-math-block-source'
          value={value}
          spellCheck={false}
          rows={Math.max(2, value.split('\n').length)}
          aria-label='LaTeX source'
          onChange={(event) => setAttrs({ value: event.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeAndReturnFocus();
              return;
            }

            const textarea = event.currentTarget;
            const { selectionStart, selectionEnd } = textarea;

            // Only a plain caret escapes; an arrow key with a selection is
            // collapsing it, which belongs to the textarea.
            if (selectionStart !== selectionEnd) return;

            const text = textarea.value;
            const onFirstLine = !text.slice(0, selectionStart).includes('\n');
            const onLastLine = !text.slice(selectionStart).includes('\n');

            // Up and down leave from the first and last *line*, so a
            // multi-line formula is still navigable line by line. Left and
            // right leave only from the very ends.
            const leaves =
              (event.key === 'ArrowUp' && onFirstLine) ||
              (event.key === 'ArrowLeft' && selectionStart === 0)
                ? -1
                : (event.key === 'ArrowDown' && onLastLine) ||
                    (event.key === 'ArrowRight' && selectionStart === text.length)
                  ? 1
                  : 0;

            if (leaves === 0) return;

            event.preventDefault();
            exitTo(leaves);
          }}
        />
      )}
    </div>
  );
};
