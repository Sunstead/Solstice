// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

const saver = vi.hoisted(() => ({
  markDirty: vi.fn(),
  schedule: vi.fn(),
  flush: vi.fn(),
  dispose: vi.fn(),
  isDirty: () => false,
  getLastWritten: () => '',
  adopt: vi.fn(),
  hold: vi.fn(),
  release: vi.fn(),
  retry: vi.fn(),
}));

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('@/lib/autosave', () => ({ createAutosaver: () => saver }));

import { CodeEditor } from './code-editor';

// A code file's tab: CodeMirror with the file's language, saving as it's
// edited, like a note's source mode.
describe('CodeEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = async (path: string, text: string, override?: string) => {
    await act(async () => {
      root.render(h(CodeEditor, { path, initialContent: text, language: override }));
    });
    const dom = container.querySelector<HTMLElement>('.cm-editor');
    expect(dom).not.toBeNull();
    const view = EditorView.findFromDOM(dom!)!;
    // The grammar is loaded on demand.
    await vi.waitFor(() => expect(view.state.facet(language)).not.toBeNull());
    return view;
  };

  it("builds the file's language", async () => {
    const view = await mount('/v/app.py', 'def main():\n    pass\n');
    expect(view.state.facet(language)?.name).toBe('python');
    expect(view.state.doc.toString()).toBe('def main():\n    pass\n');
    expect(container.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it("takes the tab's language over the file's", async () => {
    const view = await mount('/v/data.txt', '{"a": 1}', 'YAML');
    expect(view.state.facet(language)?.name).toBe('yaml');
  });

  it('schedules a save on an edit', async () => {
    const view = await mount('/v/data.json', '{}');
    act(() => view.dispatch({ changes: { from: 1, insert: '"a": 1' } }));
    expect(saver.markDirty).toHaveBeenCalled();
    expect(saver.schedule).toHaveBeenCalledWith('{"a": 1}');
  });
});
