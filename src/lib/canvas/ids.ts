/**
 * Sixteen lowercase hex characters, matching what Obsidian writes so a board
 * round-tripped through both apps has one kind of id in it.
 */
export function createCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}
