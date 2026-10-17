/**
 * The web app's share sheet: the browser's own (Safari on an iPad or
 * iPhone, some others) where it takes files, else a download.
 */
export async function shareOrDownload(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      // Put away without sharing: nothing to do.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  download(file);
}

export function download(file: Blob, name = file instanceof File ? file.name : 'download') {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
