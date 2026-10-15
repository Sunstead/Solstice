import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const tauri = path.resolve(__dirname, '../src-tauri');
const apple = path.join(tauri, 'gen/apple');

// The iPad's icon is the Mac's: mac.icon, compiled by Xcode into the app's
// asset catalog under the name CFBundleIconName gives (src-tauri/Info.plist,
// merged into iOS's too). tauri ios init's AppIcon set is Tauri's own logo.
describe('the iOS app icon', () => {
  const iconName = readFileSync(path.join(tauri, 'Info.plist'), 'utf8').match(
    /<key>CFBundleIconName<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];

  it('is named in Info.plist', () => {
    expect(iconName).toBe('mac');
  });

  it('is the one the iOS target compiles', () => {
    const yml = readFileSync(path.join(apple, 'project.yml'), 'utf8');
    expect(yml).toMatch(new RegExp(`ASSETCATALOG_COMPILER_APPICON_NAME: ${iconName}\\b`));
    expect(yml).toContain('src/assets/icons/app/mac.icon');
    const pbxproj = readFileSync(path.join(apple, 'solstice.xcodeproj/project.pbxproj'), 'utf8');
    const names = [...pbxproj.matchAll(/ASSETCATALOG_COMPILER_APPICON_NAME = (\w+);/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name === iconName)).toBe(true);
    expect(pbxproj).toContain('mac.icon in Resources');
  });

  it("isn't Tauri's template", () => {
    expect(existsSync(path.join(apple, 'Assets.xcassets/AppIcon.appiconset'))).toBe(false);
  });
});
