import type { LanguageSupport } from '@codemirror/language';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/**
 * Grammars are code-split by `language-data`'s dynamic imports, so a note with
 * thirty JavaScript blocks must not fetch the same chunk thirty times. Caching
 * the promise (not the result) also collapses concurrent loads.
 */
const loaded = new Map<string, Promise<LanguageSupport | null>>();

export const languageNames: string[] = languages
  .map((description) => description.name)
  .sort((a, b) => a.localeCompare(b));

/**
 * A couple of esolang names in `@codemirror/language-data` read as profanity
 * out of context (the picker shows plain language names in a UI, not code).
 * Parsing, highlighting and what gets written to the fence are all keyed on
 * the real name via `findLanguage` -- this only touches the label shown in
 * the picker.
 */
const CENSORED_LABELS: Record<string, string> = {
  Brainfuck: 'Brainf***',
};

export function languageLabel(name: string): string {
  return CENSORED_LABELS[name] ?? name;
}

/** Resolves a fence info string the way every markdown renderer does. */
export function findLanguage(name: string): LanguageDescription | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  return LanguageDescription.matchLanguageName(languages, trimmed, true);
}

export function loadLanguage(name: string): Promise<LanguageSupport | null> {
  const description = findLanguage(name);
  if (!description) return Promise.resolve(null);

  const cached = loaded.get(description.name);
  if (cached) return cached;

  const pending = description
    .load()
    .catch((error: unknown) => {
      console.error(`[code-block] failed to load "${description.name}"`, error);
      return null;
    });

  loaded.set(description.name, pending);
  return pending;
}
