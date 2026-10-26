import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@sunstead/ui/components/alert-dialog';

import { useAsking } from '@/lib/ask';

/** `ask`'s question where it isn't native: one for the app, at its root. */
export function AskDialog() {
  const asking = useAsking((s) => s.asking);
  return (
    <AlertDialog open={asking !== null} onOpenChange={(open) => !open && asking?.answer(false)}>
      <AlertDialogContent size='sm'>
        <AlertDialogHeader>
          <AlertDialogTitle>{asking?.title}</AlertDialogTitle>
          {asking?.message && <AlertDialogDescription>{asking.message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={asking?.destructive ? 'destructive' : 'default'}
            onClick={() => asking?.answer(true)}
          >
            {asking?.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
