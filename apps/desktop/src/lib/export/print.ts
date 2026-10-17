/**
 * Prints an export page from a hidden frame: where there's no PDF writer
 * (the web, Windows, Linux), the print dialog's Save as PDF stands in.
 */
export async function printHtml(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  // Out of sight but laid out: a frame that isn't rendered prints blank.
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' });
  frame.setAttribute('aria-hidden', 'true');
  const loaded = new Promise((resolve) => (frame.onload = resolve));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const page = frame.contentWindow;
  if (!page) return frame.remove();
  await page.document.fonts.ready;
  await Promise.all([...page.document.images].map((image) => image.decode().catch(() => {})));
  // Some browsers return from print() at once, others when the dialog closes.
  page.addEventListener('afterprint', () => frame.remove(), { once: true });
  setTimeout(() => frame.remove(), 10 * 60_000);
  page.focus();
  page.print();
}
