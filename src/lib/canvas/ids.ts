/**
 * Ids for nodes and edges.
 *
 * Sixteen lowercase hex characters, which is what Obsidian writes. The spec
 * only asks for uniqueness, but matching the format means a board that has
 * been round-tripped through both apps has one kind of id in it rather than a
 * mix of hex strings and UUIDs.
 */
export function createCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}
