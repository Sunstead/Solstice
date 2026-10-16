import { describe, expect, it } from 'vitest';
import { getSection, settingsSections } from './sections';

// On a computer, settings sit in a centred column, as Discord's do: rows
// stretched across a wide dialog are hard to read. Typography's live preview
// needs the room beside its settings.
describe('settings sections', () => {
  it('only typography takes the full width', () => {
    const wide = settingsSections.filter((s) => getSection(s.id).wide).map((s) => s.id);
    expect(wide).toEqual(['typography']);
  });
});
