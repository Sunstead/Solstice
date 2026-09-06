import { SettingsPane } from './settings-pane';

/**
 * A sample of everything the typography settings touch. Deliberately short: it
 * has to sit beside the controls without needing a scrollbar of its own, and
 * every block here earns its place by being governed by a different setting.
 *
 * No wiring connects it to the controls — the settings write their variables
 * onto the document root, so the preview reads exactly what the real editor
 * reads, through the same `.typeset` class.
 */
function Sample() {
  return (
    <div className='typeset px-4 py-3'>
      <h1>The Solstice Note</h1>
      <p>
        Body text set in the note font, at the size and leading the editor uses.
        Inline <code>code()</code> and a <strong>bold run</strong> sit inside
        the same line.
      </p>
      <h2>A second-level heading</h2>
      <ul>
        <li>A list item, to show the marker and its indent</li>
      </ul>
      <blockquote>A quotation, which takes its own rule.</blockquote>
      <pre>
        <code>{'const measure = "80ch";'}</code>
      </pre>
    </div>
  );
}

/**
 * The generated rows with a preview pinned beside them. Every control is
 * ordinary registry UI; the pane exists only to put the result on screen next
 * to the sliders that change it.
 *
 * The preview is `sticky` against the dialog's scroll area and is deliberately
 * not a scroll container itself: nesting one here meant the wheel stopped
 * moving the settings the moment the pointer crossed into the preview.
 * `items-start` is what lets it stay pinned for the whole scroll — a stretched
 * flex item is as tall as the row and has nowhere to travel.
 */
export function TypographyPane() {
  return (
    <div className='flex flex-col gap-8 lg:flex-row-reverse lg:items-start lg:gap-10'>
      <aside className='lg:sticky lg:top-6 lg:w-[23rem] lg:shrink-0'>
        <h3 className='pb-1.5 text-xs font-medium text-muted-foreground'>
          Preview
        </h3>
        <div className='overflow-hidden rounded-lg border border-border/60 bg-card'>
          <Sample />
        </div>
      </aside>

      <div className='min-w-0 flex-1'>
        <SettingsPane section='typography' />
      </div>
    </div>
  );
}
