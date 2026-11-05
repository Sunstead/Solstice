import { describe, expect, it } from 'vitest';

import { trashName } from './trash-name';

describe('trashName', () => {
  it('names where a deleted file goes, as each system calls it', () => {
    expect(trashName('desktop', 'macos')).toBe('system trash');
    expect(trashName('desktop', 'windows')).toBe('Recycle Bin');
    expect(trashName('desktop', 'linux')).toBe('Trash');
    expect(trashName('mobile', 'ios')).toBe("workspace's trash");
    expect(trashName('web', 'unknown')).toBe('trash');
  });
});
