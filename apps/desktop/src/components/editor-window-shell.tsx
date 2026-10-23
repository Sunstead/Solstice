import { TitleBarLead } from '@/components/title-bar';

/**
 * An editor window (tabs torn off a full window): its tabs, with the title
 * bar's controls over the top-left tab strip, as the main window's overhang
 * it with the sidebar collapsed (the strip's `HeaderControlsSpacer` makes
 * room). No explorer: the full window of its workspace has that.
 */
export function EditorWindowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative flex flex-1 min-h-0 w-full max-w-full'>
      <div className='flex-1 min-h-0 min-w-0 islands:p-(--island-gap) islands:pt-0'>{children}</div>
      {/* After the layout, so it paints over the strip. No z-index here: a
          stacking context would put the controls under the editor
          (`header-controls.tsx` lifts them itself). */}
      <div className='chrome absolute left-0 top-0 flex h-10 touch:h-11 items-center'>
        <TitleBarLead />
      </div>
    </div>
  );
}
