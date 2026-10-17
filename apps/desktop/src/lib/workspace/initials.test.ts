import { describe, expect, it } from 'vitest';
import { workspaceInitials } from './initials';

describe('workspaceInitials', () => {
  it('takes one word’s first letter', () => {
    expect(workspaceInitials('School')).toBe('S');
    expect(workspaceInitials('notes')).toBe('N');
  });

  it('takes the first letters of the first two words', () => {
    expect(workspaceInitials('Business Meetings')).toBe('BM');
    expect(workspaceInitials('My Big Notes')).toBe('MB');
  });

  it('breaks words at dashes, underscores, dots and camelCase', () => {
    expect(workspaceInitials('solstice-notes')).toBe('SN');
    expect(workspaceInitials('work_log')).toBe('WL');
    expect(workspaceInitials('v2.archive')).toBe('VA');
    expect(workspaceInitials('ProjectAtlas')).toBe('PA');
    expect(workspaceInitials('iOS')).toBe('I');
  });

  it('keeps a whole character, and copes with nothing', () => {
    expect(workspaceInitials('🌙 Night')).toBe('🌙N');
    expect(workspaceInitials('élan vital')).toBe('ÉV');
    expect(workspaceInitials('e\u0301cole')).toBe('E\u0301');
    expect(workspaceInitials('👩‍💻 Code')).toBe('👩‍💻C');
    expect(workspaceInitials('🇫🇷 Trip')).toBe('🇫🇷T');
    expect(workspaceInitials('   ')).toBe('?');
    expect(workspaceInitials('')).toBe('?');
  });
});
