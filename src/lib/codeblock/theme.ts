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
  '.cm-panels': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) * 0.6)',
  },
  '.cm-panels input, .cm-panels button': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) * 0.5)',
    padding: '0.125rem 0.375rem',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 20%, transparent)',
    outline: 'none',
  },
});

/**
 * Syntax colours mapped onto the chart ramp rather than invented ones, so a
 * code block sits in the same palette as everything else in the app.
 */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword], color: 'var(--chart-1)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--chart-2)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--chart-3)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: 'var(--chart-4)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: 'var(--chart-5)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--chart-4)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--foreground)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--muted-foreground)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--chart-1)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
  { tag: tags.heading, color: 'var(--chart-1)', fontWeight: 'bold' },
  { tag: tags.link, color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

export const codeBlockHighlighting = syntaxHighlighting(highlightStyle);
