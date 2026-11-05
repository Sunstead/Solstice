import { useEffect, useMemo, useState } from 'react';
import { Actions, type TabNode } from 'flexlayout-react';

import { CodeEditor } from '@/components/code-editor';
import { LanguagePicker } from '@/components/editor/language-picker';
import { UnsupportedViewer } from '@/components/viewer/unsupported-viewer';
import { ViewerHeader } from '@/components/viewer/viewer-header';
import { useLayout } from '@/hooks/use-layout';
import { commands, unwrap } from '@/lib/backend';
import { languageForFile } from '@/lib/codeblock/languages';
import { readsAsText } from '@/lib/embed/kind';
import { useKeyboardRoom } from '@/lib/keyboard';
import { takeHandoff } from '@/lib/stores/editor-text';

/** Keeps a code tab's language with the layout (`config.language`). */
function saveTabLanguage(tabId: string, language: string) {
  const { model, persistCurrent } = useLayout.getState();
  const node = model?.getNodeById(tabId) as TabNode | undefined;
  if (!model || !node) return;
  model.doAction(Actions.updateNodeAttributes(tabId, { config: { ...node.getConfig(), language } }));
  persistCurrent();
}

type CodeFileViewProps = {
  path: string;
  tabId?: string;
  /** The tab's chosen language (`config.language`). */
  language?: string;
  /** A file of unknown type: shown only if it reads as text. */
  probe?: boolean;
};

/** A code tab: the file read, its header with the language, the editor. */
export function CodeFileView({ path, tabId, language, probe = false }: CodeFileViewProps) {
  const [handed] = useState(() => takeHandoff(path));
  const [content, setContent] = useState<string | null>(handed);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(language);
  const [roomRef, room] = useKeyboardRoom();

  useEffect(() => {
    let cancelled = false;
    if (handed !== null) return;
    unwrap(commands.readFile(path))
      .then((text) => {
        if (cancelled) return;
        if (probe && !readsAsText(text)) setError('binary');
        else setContent(text);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, handed, probe]);

  // By what it held when opened, so editing never switches it.
  const detected = useMemo(() => (content === null ? '' : (languageForFile(path, content)?.name ?? '')), [path, content]);

  if (error !== null) {
    if (probe) return <UnsupportedViewer path={path} />;
    return <div className='p-4 text-destructive select-text'>Failed to load {path}: {error}</div>;
  }
  if (content === null) return <div className='p-4 text-muted-foreground'>Loading…</div>;

  const shown = chosen ?? detected;
  return (
    <div ref={roomRef} className='flex h-full flex-col' style={{ paddingBottom: room }}>
      <ViewerHeader
        path={path}
        find
        ownFind
        leading={
          <LanguagePicker
            value={shown}
            onChange={(name) => {
              setChosen(name);
              if (tabId) saveTabLanguage(tabId, name);
            }}
          />
        }
      />
      <CodeEditor path={path} initialContent={content} language={shown} />
    </div>
  );
}
