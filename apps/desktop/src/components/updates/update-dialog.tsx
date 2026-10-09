import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Progress } from '@sunstead/ui/components/progress';
import { useAppVersion } from '@/hooks/use-app-version';
import { useUpdates } from '@/lib/stores/updates';

/** Shows an available update and installs it, or a manual check's answer. One app-wide instance. */
export function UpdateDialog() {
  const open = useUpdates((s) => s.dialogOpen);
  const status = useUpdates((s) => s.status);
  const update = useUpdates((s) => s.update);
  const { install, later, check, closeDialog } = useUpdates.getState();
  const current = useAppVersion();

  const installing = status.state === 'installing';

  let title: string;
  let description: string;
  if (installing) {
    title = `Installing Solstice ${update?.version}`;
    description = 'Solstice restarts when it’s done.';
  } else if (status.state === 'checking') {
    title = 'Checking for updates…';
    description = '';
  } else if (status.state === 'error') {
    title = update ? 'The update didn’t install' : 'Couldn’t check for updates';
    description = status.message;
  } else if (update) {
    title = `Solstice ${update.version} is available`;
    description = current ? `You have ${current}.` : '';
  } else {
    title = 'Solstice is up to date';
    description = current ? `You have the latest version, ${current}.` : '';
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !installing && closeDialog()}>
      <DialogContent className='sm:max-w-lg' showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className='break-words'>{description}</DialogDescription>}
        </DialogHeader>

        {update && status.state === 'available' && update.notes.trim() && (
          <div className='max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-sm text-muted-foreground'>
            {update.notes.trim()}
          </div>
        )}

        {installing && (
          <Progress value={status.progress === null ? null : Math.round(status.progress * 100)} />
        )}

        <DialogFooter>
          {update && !installing ? (
            <>
              <Button variant='ghost' onClick={later}>
                Later
              </Button>
              <Button onClick={() => void install()}>Install & Restart</Button>
            </>
          ) : status.state === 'error' ? (
            <>
              <Button variant='ghost' onClick={closeDialog}>
                Close
              </Button>
              <Button onClick={() => void check({ manual: true })}>Try again</Button>
            </>
          ) : (
            !installing && (
              <Button onClick={closeDialog} disabled={status.state === 'checking'}>
                OK
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
