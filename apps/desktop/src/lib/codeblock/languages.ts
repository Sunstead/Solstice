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
 * Names that read as profanity out of context. Only the picker's label is
 * affected: parsing, highlighting and the fence's info string all key off the
 * real name via `findLanguage`.
 */
const CENSORED_LABELS: Record<string, string> = {
  Brainfuck: 'Brainf***',
};

export function languageLabel(name: string): string {
  return CENSORED_LABELS[name] ?? name;
}

/** Resolves a fence info string the way every markdown renderer does. */
function findLanguage(name: string): LanguageDescription | null {
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

/** Interpreters a shebang names, by the language they run. */
const SHEBANGS: Record<string, string> = {
  python: 'Python',
  node: 'JavaScript',
  bash: 'Shell',
  sh: 'Shell',
  zsh: 'Shell',
  ruby: 'Ruby',
  perl: 'Perl',
};

/** Modelines are read only this far from either end, as vim does. */
const MODELINE_LINES = 5;

function byName(name: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(languages, name, false);
}

/** `#!/usr/bin/env python3 -u` → Python. */
function fromShebang(firstLine: string): LanguageDescription | null {
  const match = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(firstLine);
  if (!match) return null;
  let program = match[1].split('/').pop() ?? '';
  if (program === 'env' && match[2]) program = match[2];
  const name = SHEBANGS[program.replace(/[\d.]+$/, '')];
  return name ? byName(name) : null;
}

/** `vim: set ft=python:`, `vim: filetype=ruby`, `-*- mode: yaml -*-`, `-*- lua -*-`. */
function fromModeline(lines: string[]): LanguageDescription | null {
  for (const line of lines) {
    const vim = /\b(?:vim?|ex):.*?\b(?:ft|filetype|syntax)=([\w+-]+)/.exec(line);
    const emacs = /-\*-\s*(?:.*?\bmode:\s*([\w+-]+)|([\w+-]+)\s*-\*-)/.exec(line);
    const name = vim?.[1] ?? emacs?.[1] ?? emacs?.[2];
    const found = name ? byName(name) : null;
    if (found) return found;
  }
  return null;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * A code tab's language: by the file's name, else its shebang, a modeline,
 * an XML declaration or JSON. `null` is plain text.
 */
export function languageForFile(path: string, text: string): LanguageDescription | null {
  const name = path.slice(path.search(/[^\\/]*$/));
  // Extensions are matched as written: `MAIN.RS` is Rust too.
  const byFile =
    LanguageDescription.matchFilename(languages, name) ??
    LanguageDescription.matchFilename(languages, name.replace(/\.[^.]+$/, (e) => e.toLowerCase()));
  if (byFile) return byFile;

  const lines = text.split('\n', MODELINE_LINES);
  const tail = text.slice(-2000).split('\n').slice(-MODELINE_LINES);
  const sniffed =
    fromShebang(lines[0] ?? '') ??
    fromModeline([...lines, ...tail]) ??
    (text.trimStart().startsWith('<?xml') ? byName('XML') : null);
  if (sniffed) return sniffed;
  return looksLikeJson(text) ? byName('JSON') : null;
}
