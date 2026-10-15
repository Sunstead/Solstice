import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsDialog } from './settings-dialog';

const state = () => useSettingsDialog.getState();

// The touch dialog: a list of sections, each pushed as a page of its own.
describe('settings pages', () => {
  beforeEach(() => state().close());

  it('opens on the list', () => {
    state().openSettings();
    expect(state().page).toBeNull();
  });

  it('opens straight on a section asked for, with the list behind it', () => {
    state().openSettings('sync');
    expect(state().page).toBe('sync');
    expect(state().shown).toBe('sync');
    state().popPage();
    expect(state().page).toBeNull();
  });

  it('keeps showing a page while it slides away', () => {
    state().openSettings();
    state().pushPage('editor');
    expect(state().page).toBe('editor');
    state().popPage();
    expect(state().page).toBeNull();
    expect(state().shown).toBe('editor');
  });

  it('clears the search when a page opens, as the split view does', () => {
    state().openSettings();
    state().setQuery('font');
    state().pushPage('typography');
    expect(state().query).toBe('');
    expect(state().activeSection).toBe('typography');
  });

  it('starts over on the list once closed', () => {
    state().openSettings('sync');
    state().close();
    expect(state().page).toBeNull();
    state().openSettings();
    expect(state().page).toBeNull();
  });
});
