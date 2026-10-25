import { useRef, useState } from 'react';
import { ChevronsUpDown, LogIn, LogOut } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { useAccountActions } from '@/hooks/use-account-actions';
import { SettingsSectionBody, SettingsSectionList } from '@/components/settings/settings-nav';
import { SettingsSearch } from '@/components/settings/settings-search';
import { SettingsSearchResults } from '@/components/settings/settings-search-results';
import { SyncStatusLine } from '@/components/sync/status';
import { UserAvatar } from '@/components/user-avatar';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { can } from '@/lib/backend/platform';
import { getSection, type SectionId } from '@/lib/settings/sections';
import { usePhoneNav } from '@/lib/stores/phone-nav';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useSync } from '@/lib/stores/sync';
import { WorkspacesSheet } from './files-page';
import { PhoneHeader, PhoneTitle, PushedHeader, Row, RowGroup } from './phone-parts';
import { PushPane } from './push-pane';

/**
 * You: the account, the workspace, and settings, one section per row, each
 * pushed as a page of its own (the dialog's panes, unchanged).
 */
export function YouPage() {
  const sections = usePhoneNav((s) => s.sections);
  const pushSection = usePhoneNav((s) => s.pushSection);
  const popSection = usePhoneNav((s) => s.popSection);
  const query = useSettingsDialog((s) => s.query.trim());
  const setQuery = useSettingsDialog((s) => s.setQuery);
  const { activeName, activeColor } = useWorkspaceChoices();
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const page = useRef<HTMLDivElement>(null);

  const section = usePhoneNav((s) => s.section);

  const open = (id: SectionId) => {
    setQuery('');
    pushSection(id);
  };

  return (
    <div data-phone-page='you' className='absolute inset-0 overflow-hidden bg-background'>
      <div ref={page} className='flex h-full flex-col'>
        <PhoneHeader large>
          <PhoneTitle>You</PhoneTitle>
        </PhoneHeader>
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          <div className='mx-auto flex max-w-xl flex-col gap-6 px-4 py-5'>
            <AccountCard onOpenSync={() => open('sync')} />
            <RowGroup title='Workspace'>
              <Row
                leading={activeName && activeColor && <WorkspaceIcon name={activeName} color={activeColor} size='lg' />}
                label={activeName ?? 'No workspace open'}
                detail={<ChevronsUpDown className='size-4 shrink-0 text-muted-foreground' />}
                onClick={() => setWorkspacesOpen(true)}
              />
            </RowGroup>
            <section className='flex flex-col gap-1.5'>
              <h2 className='px-3 text-xs font-medium text-muted-foreground'>Settings</h2>
              <SettingsSearch className='[&_input]:h-10' />
              {query ? (
                <div className='pt-1'>
                  <SettingsSearchResults query={query} onOpenSection={open} />
                </div>
              ) : (
                <div className='mt-1.5'>
                  <SettingsSectionList onOpen={open} />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      <PushPane open={sections.length > 0} onClose={popSection} behind={page}>
        {section && <SectionPage id={section} back={backName(sections, section)} onBack={popSection} />}
      </PushPane>
      <WorkspacesSheet open={workspacesOpen} onOpenChange={setWorkspacesOpen} />
    </div>
  );
}

/** Where Back on `shown` goes: the section pushed before it, or You. */
function backName(sections: SectionId[], shown: SectionId) {
  const at = sections.lastIndexOf(shown);
  const before = at > 0 ? sections[at - 1] : at < 0 ? sections[sections.length - 1] : undefined;
  return before ? getSection(before).label : 'You';
}

function SectionPage({ id, back, onBack }: { id: SectionId; back: string; onBack: () => void }) {
  const section = getSection(id);
  return (
    <>
      <PushedHeader back={back} onBack={onBack} title={section.label} />
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        <div className='mx-auto max-w-xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'>
          <SettingsSectionBody id={id} />
        </div>
      </div>
    </>
  );
}

/** Who's signed in, signing in or out, and how this workspace syncs. */
function AccountCard({ onOpenSync }: { onOpenSync: () => void }) {
  const { username, status, host, busy, failure, signIn, signOut } = useAccountActions();
  const linked = useSync((s) => s.info);

  return (
    <div className='phone-rows flex flex-col overflow-hidden rounded-xl bg-card'>
      <div className='flex items-center gap-3 p-3'>
        <UserAvatar username={username} size='lg' />
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-[15px] font-medium'>{username ?? status}</span>
          {host && <span className='truncate text-xs text-muted-foreground'>{host}</span>}
          {failure && <span className='text-xs text-destructive select-text'>{failure}</span>}
        </div>
        {username ? (
          <Button variant='outline' size='sm' disabled={busy} onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        ) : (
          can.syncSettings && (
            <Button size='sm' disabled={busy} onClick={() => void signIn()}>
              <LogIn />
              Sign in
            </Button>
          )
        )}
      </div>
      {linked && (
        <button type='button' onClick={onOpenSync} className='p-3 text-left active:bg-accent'>
          <SyncStatusLine info={linked} />
        </button>
      )}
    </div>
  );
}
