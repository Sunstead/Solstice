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
