import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { invoke } from '@tauri-apps/api/core';

type MilkdownEditorProps = {
  path: string;
  initialContent: string;
  onError: (message: string) => void;
};

const MilkdownEditor: React.FC<MilkdownEditorProps> = ({
  path,
  initialContent,
  onError,
}) => {
  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialContent);
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            invoke('write_file', { path, contents: markdown }).catch((err) =>
              onError(String(err)),
            );
          });
        })
        .use(listener)
        .use(commonmark),
    [path],
  );

  return <Milkdown />;
};

type MilkdownEditorWrapperProps = MilkdownEditorProps;

export const MilkdownEditorWrapper: React.FC<MilkdownEditorWrapperProps> = (
  props,
) => {
  return (
    <MilkdownProvider>
      <MilkdownEditor {...props} />
    </MilkdownProvider>
  );
};
