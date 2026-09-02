import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * CodeMirror styled from the app's own tokens.
 *
 * Every colour is a `var()`, so one theme serves light and dark alike and
 * follows a theme change with no JavaScript -- the same reasoning behind
 * `wikilink.css` having no dark-mode branch. `@codemirror/theme-one-dark` is
 * deliberately unused: it hard-codes a palette that has nothing to do with the
 * rest of the editor.
 */
export const codeBlockTheme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '0.875em',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    padding: '0.75rem 0',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': { padding: '0 0.875rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in oklch, var(--muted-foreground) 60%, transparent)',
    border: 'none',
    paddingLeft: '0.5rem',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--foreground) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted-foreground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 55%, transparent)',
  },
  // The panel's own contents (the search UI) are real shadcn components with
  // their own complete styling; only the bar they sit in is themed here.
  '.cm-panels': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) * 0.6)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 20%, transparent)',
    outline: 'none',
  },
});

/**
 * Syntax colours, mapped onto their own palette (`--syntax-*` in `app.css`)
 * rather than the chart ramp: `--chart-1..5` is a flat greyscale in this
 * theme, so code using it never actually looked colourful, just shaded.
 *
 * Structural tokens -- punctuation, brackets, operators -- stay on
 * `--muted-foreground` on purpose: colouring everything makes nothing stand
 * out, and the point of syntax colour is to separate the few token kinds that
 * carry meaning from the scaffolding around them.
 */
const highlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.comment,
      tags.lineComment,
      tags.blockComment,
      tags.docComment,
      tags.docString,
    ],
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  { tag: [tags.meta, tags.documentMeta, tags.processingInstruction], color: 'var(--muted-foreground)' },

  {
    tag: [
      tags.keyword,
      tags.moduleKeyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
    ],
    color: 'var(--syntax-keyword)',
  },

  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.attributeValue],
    color: 'var(--syntax-string)',
  },
  { tag: tags.inserted, color: 'var(--syntax-string)' },

  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom, tags.color], color: 'var(--syntax-number)' },

  {
    tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.self, tags.escape],
    color: 'var(--syntax-constant)',
  },
  { tag: tags.changed, color: 'var(--syntax-constant)' },

  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName, tags.labelName],
    color: 'var(--syntax-function)',
  },

  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName), tags.typeOperator],
    color: 'var(--syntax-type)',
  },

  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },

  // Plain identifiers are deliberately left uncoloured -- only the special
  // roles above (functions, types, constants...) earn a colour, which is what
  // makes those readable as landmarks rather than noise.
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--foreground)' },

  {
    tag: [
      tags.operator,
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.paren,
      tags.brace,
      tags.squareBracket,
      tags.derefOperator,
      tags.arithmeticOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.logicOperator,
      tags.controlOperator,
    ],
    color: 'var(--muted-foreground)',
  },

  { tag: [tags.tagName, tags.angleBracket, tags.contentSeparator], color: 'var(--syntax-tag)' },
  { tag: tags.heading, color: 'var(--syntax-tag)', fontWeight: 'bold' },

  { tag: tags.invalid, color: 'var(--destructive)' },
  { tag: tags.deleted, color: 'var(--destructive)' },

  { tag: tags.link, color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

export const codeBlockHighlighting = syntaxHighlighting(highlightStyle);
