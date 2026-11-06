import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Association = { ext: string[]; role: string; rank?: string; mimeType?: string };
const associations = (platform: string): Association[] =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../src-tauri/tauri.${platform}.conf.json`), 'utf8')).bundle
    .fileAssociations;

// Each desktop platform has its own file (a phone has no handler for them),
// so Markdown is written three times: these keep them in step.
describe('file associations', () => {
  const markdown = (platform: string) => associations(platform).find((a) => a.ext.includes('md'));

  it.each(['macos', 'windows', 'linux'])('registers Markdown as an editor that can be the default on %s', (platform) => {
    expect(markdown(platform)).toMatchObject({ ext: ['md', 'markdown'], role: 'Editor', rank: 'Default' });
    expect(markdown(platform)).toEqual(markdown('macos'));
  });

  it('offers code on macOS only under Open With', () => {
    const code = associations('macos').filter((a) => !a.ext.includes('md'));
    expect(code.length).toBeGreaterThan(0);
    for (const a of code) expect(a.rank).toBe('Alternate');
  });

  it('leaves Windows to Markdown, as its installer would take over code files', () => {
    expect(associations('windows')).toHaveLength(1);
  });
});

// Tauri's own .desktop has no field code, so a file manager would start the
// app without the file: the template passes them (`%U`, as `file://` URIs
// that `paths_from_args` reads), and lists the types itself.
describe('the Linux desktop entry', () => {
  const template = readFileSync(path.resolve(__dirname, '../src-tauri/linux/solstice.desktop.hbs'), 'utf8');
  const mimeTypes = template.match(/^MimeType=(.*)$/m)![1].split(';').filter(Boolean);

  it('passes what it opens to the app', () => {
    expect(template).toMatch(/^Exec=\{\{exec\}\} %U$/m);
  });

  it('lists every type the Linux bundle registers, and solstice:// links', () => {
    for (const a of associations('linux')) if (a.mimeType) expect(mimeTypes).toContain(a.mimeType);
    expect(mimeTypes).toContain('x-scheme-handler/solstice');
  });
});
