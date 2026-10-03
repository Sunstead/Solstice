/**
 * Deliberately conservative: it must agree with what GFM's own autolink
 * parsing produces when the same file is read back from disk, or text would
 * visibly change shape on reload.
 */
const URL_PATTERN = /^(?:https?:\/\/|mailto:)[^\s<>]+$/i;

/** Trailing punctuation almost always belongs to the sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function isUrl(value: string): boolean {
  return URL_PATTERN.test(value.trim());
}

export function trimUrl(value: string): string {
  return value.replace(TRAILING, '');
}

/** Only schemes a browser should be handed. */
export function isSafeExternalHref(href: string): boolean {
  return /^(?:https?|mailto):/i.test(href.trim());
}
