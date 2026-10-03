import { pdfjs } from 'react-pdf';

import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

/*
 * pdf.js does its parsing off the main thread, and will not start at all
 * without being told where its worker lives.
 *
 * `new URL(..., import.meta.url)` is the form Vite recognises, so the worker
 * ships as a real bundled chunk rather than a CDN fetch -- which a desktop app
 * with no network has no way to satisfy. `pdfjs-dist` is pinned in
 * `package.json` to exactly the version `react-pdf` depends on: a mismatch
 * between the API and the worker fails at runtime, not at build time.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { pdfjs };
