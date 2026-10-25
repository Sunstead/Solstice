/** Any CSS colour (themes use oklch) as sRGB, by painting it; none if see-through. */
export function toRgb(color: string): number[] | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r, g, b];
}
