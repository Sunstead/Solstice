import { describe, expect, it } from 'vitest';
import { linkSummary } from './link-summary';

describe('linkSummary', () => {
  it('says what moved, leaving out what did not', () => {
    expect(linkSummary({ uploaded: 3, downloaded: 1, same: 0 })).toBe('3 files uploaded, 1 file downloaded.');
    expect(linkSummary({ uploaded: 0, downloaded: 0, same: 2 })).toBe('2 files already matched.');
    expect(linkSummary({ uploaded: 0, downloaded: 0, same: 0 })).toBe('There were no files to sync yet.');
  });
});
