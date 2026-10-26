import type { ReactNode } from 'react';

import { Button } from '@sunstead/ui/components/button';
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePhoneSheets } from '@/hooks/use-phone-sheets';

/**
 * A form's title and buttons, laid out for where it is. In a dialog, a
 * header with the description and a footer of Cancel and the confirm button;
 * on a phone, where the dialog is a sheet (`DialogContent`), iOS's bar:
 * Cancel on the left, the title in the middle, the confirm (bold, tinted,
 * disabled until it can) on the right, and the description under the fields.
 * `confirm` null leaves only Cancel (`cancel` names it: Close).
 */
export function FormLayout({
  title,
  description,
  confirm,
  cancel = 'Cancel',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  confirm: { label: string; disabled?: boolean } | null;
  cancel?: string;
  children: ReactNode;
}) {
  if (usePhoneSheets()) {
    return (
      <>
        <div className='-mx-1 grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-2'>
          <DialogClose
            render={<button type='button' className='phone-tint justify-self-start text-[17px] active:opacity-40' />}
          >
            {cancel}
          </DialogClose>
          <DialogTitle className='truncate text-[17px] font-semibold'>{title}</DialogTitle>
          {confirm ? (
            <button
              type='submit'
              disabled={confirm.disabled}
              className='phone-tint justify-self-end text-[17px] font-semibold active:opacity-40 disabled:text-muted-foreground'
            >
              {confirm.label}
            </button>
          ) : (
            <span />
          )}
        </div>
        {children}
        {description && <DialogDescription className='px-1 text-[13px]'>{description}</DialogDescription>}
      </>
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children}
      <DialogFooter>
        <DialogClose render={<Button type='button' variant={confirm ? 'outline' : 'default'} />}>{cancel}</DialogClose>
        {confirm && (
          <Button type='submit' disabled={confirm.disabled}>
            {confirm.label}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
