import { type SyncLinkReport } from '@/bindings';

function files(n: number) {
  return n === 1 ? '1 file' : `${n} files`;
}

/** What linking a workspace to a vault did, in a sentence. */
export function linkSummary(report: Pick<SyncLinkReport, 'uploaded' | 'downloaded' | 'same'>): string {
  const moved = [
    report.uploaded > 0 && `${files(report.uploaded)} uploaded`,
    report.downloaded > 0 && `${files(report.downloaded)} downloaded`,
    report.same > 0 && `${files(report.same)} already matched`,
  ].filter(Boolean);
  return moved.length > 0 ? `${moved.join(', ')}.` : 'There were no files to sync yet.';
}
