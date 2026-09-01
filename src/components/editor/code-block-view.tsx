import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { openSearchPanel, search } from '@codemirror/search';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { redo, undo } from '@milkdown/kit/prose/history';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { exitCode } from '@milkdown/kit/prose/commands';
import { Check, ChevronsUpDown, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { isSyncingFromDoc, syncFromDoc } from '@/lib/codeblock/bridge';
import { codeBlockHighlighting, codeBlockTheme } from '@/lib/codeblock/theme';
import {
  languageLabel,
  languageNames,
  loadLanguage,
} from '@/lib/codeblock/languages';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useSetting } from '@/lib/settings/store';
import { cn } from '@/lib/utils';

/** Smallest edit that turns `before` into `after`, as CodeMirror wants it. */
function computeChange(before: string, after: string) {
  if (before === after) return null;

  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;

  while (
    start < endBefore &&
    before.charCodeAt(start) === after.charCodeAt(start)
  ) {
    start += 1;
  }
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

function syncScrollerHeight(cm: EditorView) {
  cm.scrollDOM.style.height = `${cm.contentHeight}px`;
}

/**
 * Code blocks as a real CodeMirror editor.
 *
 * CodeMirror deliberately keeps **no history of its own**: every code edit is
 * forwarded as a ProseMirror transaction, so the document's undo stack already
 * contains it, and `Mod-z` is wired straight back to ProseMirror's history.
 * Two competing histories over the same text is the classic way this
 * integration goes wrong.
 */
export const CodeBlockView: React.FC = () => {
  const { node, view, getPos } = useNodeViewContext();
  const scopeId = useId();

  const hostRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<EditorView | null>(null);
  // CodeMirror callbacks outlive any single render, so the bridge reads the
  // current node and position through refs rather than closing over them.
  const nodeRef = useRef(node);
  const getPosRef = useRef(getPos);

  nodeRef.current = node;
  getPosRef.current = getPos;

  const language: string = node.attrs.language ?? '';
  const showLineNumbers = useSetting('editor.codeLineNumbers');

  const languageCompartment = useMemo(() => new Compartment(), []);
  const gutterCompartment = useMemo(() => new Compartment(), []);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /**
     * CodeMirror change -> ProseMirror transaction.
     *
     * The selection is forwarded alongside the text so ProseMirror's own
     * selection stays inside this block. ProseMirror writes its selection back
     * to the DOM after every transaction, and a selection pointing outside
     * would drag the browser caret out of CodeMirror on each keystroke.
     */
    const forwardUpdate = (update: ViewUpdate) => {
      const cmView = update.view;
      // Only mirror what the user did here. Changes pushed in from the
      // document arrive already applied, and echoing them back would loop.
      if (isSyncingFromDoc(cmView) || !cmView.hasFocus) return;

      const base = getPosRef.current();
      if (base === undefined) return;

      const start = base + 1;
      const { main } = update.state.selection;
      const selectionFrom = start + main.from;
      const selectionTo = start + main.to;
      const pmSelection = view.state.selection;

      if (
        !update.docChanged &&
        pmSelection.from === selectionFrom &&
        pmSelection.to === selectionTo
      ) {
        return;
      }

      let offset = start;
      const tr = view.state.tr;

      update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
        const inserted = text.toString();

        if (inserted.length) {
          tr.replaceWith(
            offset + fromA,
            offset + toA,
            view.state.schema.text(inserted),
          );
        } else {
          tr.delete(offset + fromA, offset + toA);
        }

        offset += toB - fromB - (toA - fromA);
      });

      const limit = tr.doc.content.size;
      if (selectionFrom <= limit && selectionTo <= limit) {
        tr.setSelection(
          TextSelection.create(tr.doc, selectionFrom, selectionTo),
        );
      }

      view.dispatch(tr);
    };

    /**
     * Arrow keys leave the block when there is nowhere left to go inside it,
     * so a code block at the very top or bottom of a note is never a trap.
     */
    const maybeEscape =
      (unit: 'line' | 'char', dir: -1 | 1) => (cm: EditorView) => {
        const { state } = cm;
        const selection = state.selection.main;
        if (!selection.empty) return false;

        const range =
          unit === 'line' ? state.doc.lineAt(selection.head) : selection;
        if (dir < 0 ? range.from > 0 : range.to < state.doc.length)
          return false;

        const base = getPosRef.current();
        if (base === undefined) return false;

        const target = dir < 0 ? base : base + nodeRef.current.nodeSize;
        const next = Selection.near(view.state.doc.resolve(target), dir);

        view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
        view.focus();
        return true;
      };

    const cm = new EditorView({
      state: EditorState.create({
        doc: node.textContent,
        extensions: [
          gutterCompartment.of(showLineNumbers ? lineNumbers() : []),
          languageCompartment.of([]),
          codeBlockTheme,
          codeBlockHighlighting,
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          search(),
          EditorView.lineWrapping,
          keymap.of([
            { key: 'ArrowUp', run: maybeEscape('line', -1) },
            { key: 'ArrowLeft', run: maybeEscape('char', -1) },
            { key: 'ArrowDown', run: maybeEscape('line', 1) },
            { key: 'ArrowRight', run: maybeEscape('char', 1) },
            {
              key: 'Mod-Enter',
              run: () => {
                if (!exitCode(view.state, view.dispatch)) return false;
                view.focus();
                return true;
              },
            },
            // Undo belongs to the document, not to this block -- see above.
            { key: 'Mod-z', run: () => undo(view.state, view.dispatch) },
            { key: 'Mod-Shift-z', run: () => redo(view.state, view.dispatch) },
            { key: 'Mod-y', run: () => redo(view.state, view.dispatch) },
            {
              key: 'Backspace',
              run: (cm) => {
                if (cm.state.doc.length > 0) return false;

                const base = getPosRef.current();
                if (base === undefined) return false;

                const tr = view.state.tr.delete(
                  base,
                  base + nodeRef.current.nodeSize,
                );
                tr.setSelection(Selection.near(tr.doc.resolve(base), -1));

                view.dispatch(tr);
                view.focus();
                return true;
              },
            },
            indentWithTab,
            // Ahead of the default keymap so its Backspace binding, which
            // removes both halves of an auto-inserted pair, wins.
            ...closeBracketsKeymap,
            ...defaultKeymap.filter(
              (binding) => !['Mod-Enter'].includes(String(binding.key)),
            ),
          ]),
          EditorView.updateListener.of(forwardUpdate),
          EditorView.updateListener.of((update) => {
            if (update.heightChanged) syncScrollerHeight(update.view);
          }),
        ],
      }),
      parent: host,
    });

    cmRef.current = cm;
    syncScrollerHeight(cm);

    // Focus tracking: `view.dom`'s own `focus` listener does not fire for a
    // nested editable (focus does not bubble), so this block claims the active
    // scope while it holds focus and ProseMirror reclaims it on the way back.
    const claimScope = () =>
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    cm.contentDOM.addEventListener('focus', claimScope);

    // Only the commands that mean something in here are registered. Anything
    // absent -- edit.bold, the headings, edit.code_block -- resolves to this
    // scope, finds no handler, and correctly does nothing, instead of yanking
    // focus back to the prose editor and formatting the wrong thing.
    registerScopedCommand(scopeId, 'native.undo', () => {
      undo(view.state, view.dispatch);
    });
    registerScopedCommand(scopeId, 'native.redo', () => {
      redo(view.state, view.dispatch);
    });
    registerScopedCommand(scopeId, 'native.copy', () => {
      document.execCommand('copy');
    });
    registerScopedCommand(scopeId, 'native.cut', () => {
      document.execCommand('cut');
    });
    registerScopedCommand(scopeId, 'native.paste', () => {
      void navigator.clipboard.readText().then((text) => {
        cm.dispatch(cm.state.replaceSelection(text));
      });
    });
    registerScopedCommand(scopeId, 'native.select_all', () => {
      // Focus first: the update listener only forwards a selection to the
      // document while this instance holds focus.
      cm.focus();
      cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
    });
    // The document-wide find bar cannot reach inside CodeMirror, so this block
    // gets CodeMirror's own search panel instead of nothing.
    registerScopedCommand(scopeId, 'edit.find', () => {
      openSearchPanel(cm);
    });

    return () => {
      cm.contentDOM.removeEventListener('focus', claimScope);

      for (const id of [
        'native.undo',
        'native.redo',
        'native.copy',
        'native.cut',
        'native.paste',
        'native.select_all',
        'edit.find',
      ] as const) {
        unregisterScopedCommand(scopeId, id);
      }

      cm.destroy();
      cmRef.current = null;
    };
    // Built once per node view: rebuilding on every render would lose the
    // cursor and the undo-facing update listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ProseMirror change -> CodeMirror, minimally. */
  useEffect(() => {
    const cm = cmRef.current;
    if (!cm) return;

    const change = computeChange(cm.state.doc.toString(), node.textContent);
    if (!change) return;

    syncFromDoc(cm, () => cm.dispatch({ changes: change }));
  }, [node]);

  useEffect(() => {
    const cm = cmRef.current;
    if (!cm) return;

    let cancelled = false;
    void loadLanguage(language).then((support) => {
      if (cancelled || !cmRef.current) return;
      cm.dispatch({
        effects: languageCompartment.reconfigure(support ? [support] : []),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [language, languageCompartment]);

  useEffect(() => {
    const cm = cmRef.current;
    if (!cm) return;

    cm.dispatch({
      effects: gutterCompartment.reconfigure(
        showLineNumbers ? lineNumbers() : [],
      ),
    });
  }, [showLineNumbers, gutterCompartment]);

  const setLanguage = (next: string) => {
    const pos = getPos();
    if (pos === undefined) return;

    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: next,
      }),
    );
    setPickerOpen(false);
  };

  const copy = () => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  // `contentEditable={false}` is load-bearing: the adapter gives every
  // non-leaf node a `contentDOM`, so ProseMirror never marks this node view
  // uneditable and the subtree inherits `contenteditable` from the document.
  // CodeMirror's `.cm-content` cannot become its own editing host inside
  // another one, so the browser routes editing to ProseMirror, the caret never
  // advances, and typed text comes out reversed. This also keeps the gutters
  // from being editable.
  return (
    <div
      className='solstice-code-block'
      data-not-typeset
      contentEditable={false}
    >
      <div className='solstice-code-block-bar'>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button variant='ghost' size='xs' className='font-mono'>
                {language ? languageLabel(language) : 'plain text'}
                <ChevronsUpDown />
              </Button>
            }
          />
          <PopoverContent align='start' className='w-56 p-0'>
            <Command>
              <CommandInput placeholder='Language…' />
              <CommandList>
                <CommandEmpty>No language found.</CommandEmpty>
                {['plain text', ...languageNames].map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() =>
                      setLanguage(name === 'plain text' ? '' : name)
                    }
                  >
                    <Check
                      className={cn(
                        'size-3.5',
                        (language || 'plain text') === name
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                    {name === 'plain text' ? name : languageLabel(name)}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button variant='ghost' size='icon-xs' onClick={copy} title='Copy code'>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>

      <div ref={hostRef} className='solstice-code-block-editor' />
    </div>
  );
};
