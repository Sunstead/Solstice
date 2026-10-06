/** "PB" for preston.b, "P" for preston, for an avatar without a picture. */
export function initials(name: string): string {
  const words = name.trim().split('@')[0].split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}
