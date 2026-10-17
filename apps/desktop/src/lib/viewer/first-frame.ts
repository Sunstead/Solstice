/**
 * `src` for a video that shows its first frame before it plays. WebKit (the
 * Mac and iPad apps) paints nothing for a video it has only read the metadata
 * of; a media fragment's start time makes it seek, which paints that frame.
 * Play still starts from the beginning. A fragment already there is kept.
 */
export function firstFrameSrc(src: string): string {
  return src.includes('#') ? src : `${src}#t=0.001`;
}
