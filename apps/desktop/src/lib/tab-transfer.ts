/**
 * Tabs moving between windows, as in VS Code: drag one out of the window and
 * it opens in a window of its own (an editor window, `lib/stores/app-window`);
 * drag it onto another window of the same workspace and it lands where
 * flexlayout's indicators show.
 *
 * A drag can't carry anything another window can read before the drop, so
 * the source tells the others what's coming (`announceTabDrag`), and each
 * one's `onExternalDrag` takes it from `useIncomingTab`, as file tree drags
 * are taken from their own store. The target says it took the tab
 * (`tabAdopted`), and the source saves its editors and lets it go.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Actions, DockLocation, type IJsonTabNode, type Model, TabNode } from 'flexlayout-react';
import type { PointerSpot, WindowEntry } from '@/bindings';

import { commands, events } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
import { flushAllAutosavers } from '@/lib/autosave';
import { useAppWindow } from '@/lib/stores/app-window';
import { useWorkspace } from '@/hooks/use-workspace';
import { log } from '@/lib/backend/log';

export type TabPayload = {
  /** The window it's leaving. */
  source: string;
  tabId: string;
  workspace: string;
  /** The tab as flexlayout JSON, without its id: the target gives it one. */
  json: IJsonTabNode;
};

type Point = { x: number; y: number };

export function tabPayload(
  model: Model,
  tabId: string,
  from: { source: string; workspace: string },
): TabPayload | null {
  const node = model.getNodeById(tabId);
  if (!(node instanceof TabNode)) return null;
  const json: IJsonTabNode = { type: 'tab', name: node.getName(), component: node.getComponent() };
  const config = node.getConfig();
  if (config !== undefined) json.config = config;
  return { ...from, tabId, json };
}

export function encodeTab(payload: TabPayload): string {
  return JSON.stringify(payload);
}

export function decodeTab(text: string | null | undefined): TabPayload | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text) as Partial<TabPayload>;
    if (
      typeof p.source !== 'string' ||
      typeof p.tabId !== 'string' ||
      typeof p.workspace !== 'string' ||
      typeof p.json !== 'object' ||
      p.json === null
    ) {
      return null;
    }
    return p as TabPayload;
  } catch {
    return null;
  }
}

/**
 * A tab let go of where no window took it, outside its own window and over
 * none of the others, becomes a window of its own.
 */
export function shouldTearOff({
  dropEffect,
  inside,
  over,
}: {
  dropEffect: string;
  inside: boolean;
  over: string | null;
}): boolean {
  return dropEffect === 'none' && !inside && over === null;
}

/** What a tab's drag carries in place of flexlayout's placeholder text. */
export const TAB_TYPE = 'application/x-solstice-tab';

export function isTabDrag(types: readonly string[] | undefined): boolean {
  return types?.includes(TAB_TYPE) ?? false;
}

/**
 * Swaps flexlayout's placeholder text for a type of our own: text is what
 * other apps (VS Code, a text field) take, and a drop one takes is a tab
 * that never tears off.
 */
export function dragData(transfer: Pick<DataTransfer, 'clearData' | 'setData'>, source: string) {
  transfer.clearData();
  transfer.setData(TAB_TYPE, source);
}

/** Keeps a tab dropped on an editor where no layout took it out of the note. */
export function refuseStrayTabDrops() {
  document.addEventListener(
    'drop',
    (e) => {
      if (!isTabDrag(e.dataTransfer?.types)) return;
      // While a layout takes the drag, its overlay is what's under the
      // pointer, never an editor, so its own drop still runs.
      const editor = (e.target as Element | null)?.closest?.('.ProseMirror, .cm-editor, [contenteditable], input, textarea');
      if (editor) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

/**
 * Ends whatever drag flexlayout thinks is under way in `root`, through a tab
 * button's own `dragend` handler. WebKit doesn't always send `dragend` when a
 * drag ends over another app, and flexlayout's overlay then stays up,
 * taking every click.
 */
function endLayoutDrag(root: ParentNode) {
  root.querySelector('.flexlayout__tab_button')?.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
}

/** The tab another window is dragging, while it is. */
export const useIncomingTab = create<{ payload: TabPayload | null }>(() => ({ payload: null }));

function newTabId(): string {
  return crypto.randomUUID();
}

/** The incoming tab as this window's `onExternalDrag` wants it, if it can take it. */
export function incomingDrag(workspace: string | null) {
  const payload = useIncomingTab.getState().payload;
  // Paths and links only mean something in their own workspace.
  if (!payload || payload.workspace !== workspace) return undefined;
  return {
    json: { ...payload.json, id: newTabId() },
    onDrop: () => {
      useIncomingTab.setState({ payload: null });
      void commands.tabAdopted(payload.source, payload.tabId);
    },
  };
}

/** Saves what the tab's editor holds, then takes the tab out. */
async function release(model: Model, tabId: string) {
  // Every editor here, not just the tab's: they're few, and the other
  // window reads the file as soon as it opens it.
  await flushAllAutosavers();
  if (model.getNodeById(tabId)) model.doAction(Actions.deleteTab(tabId));
}

/** Opens the tab in an editor window of its own, `at` a point on the screen. */
export async function moveTabToNewWindow(model: Model, tabId: string, at: Point | null = null) {
  const { label } = useAppWindow.getState();
  const workspace = useWorkspace.getState().path;
  if (!workspace) return;
  const payload = tabPayload(model, tabId, { source: label, workspace });
  if (!payload) return;
  // Saved first, so the new window reads what this one had.
  await flushAllAutosavers();
  const result = await commands.openWindow({
    editor: true,
    workspace,
    tab: JSON.stringify({ ...payload.json, id: newTabId() }),
    at,
  });
  if (result.status === 'error') {
    console.error('Failed to open a window:', result.error);
    return;
  }
  await release(model, tabId);
}

/** Sends the tab to another window of this workspace (Move to Window). */
export async function moveTabToWindow(model: Model, tabId: string, target: string) {
  const workspace = useWorkspace.getState().path;
  const payload = workspace && tabPayload(model, tabId, { source: useAppWindow.getState().label, workspace });
  if (!payload) return;
  await flushAllAutosavers();
  const result = await commands.sendTab(target, encodeTab(payload));
  if (result.status === 'error') console.error('Failed to move the tab:', result.error);
}

/** Takes a tab another window sent, into the shown tabset, and tells it so. */
function adopt(model: Model, payload: TabPayload) {
  const tabset = model.getActiveTabset() ?? model.getFirstTabSet();
  if (!tabset) return;
  model.doAction(Actions.addTab({ ...payload.json, id: newTabId() }, tabset.getId(), DockLocation.CENTER, -1));
  void commands.tabAdopted(payload.source, payload.tabId);
}

/** The other windows of this workspace, a tab can go to. */
export function useSiblingWindows(): WindowEntry[] {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  useEffect(() => {
    if (!can.multiWindow) return;
    const refresh = () =>
      void commands.listWindows().then((all) => {
        const { label } = useAppWindow.getState();
        const workspace = useWorkspace.getState().path;
        setWindows(all.filter((w) => w.label !== label && w.workspace === workspace));
      });
    refresh();
    const unlisten = events.windowsChanged.listen(refresh);
    return () => void unlisten.then((f) => f());
  }, []);
  return windows;
}

/**
 * Wires a layout's tabs to other windows: announces drags out of it, tears a
 * tab off where nothing took it, and lets go of tabs another window took.
 */
export function useTabTransfer(container: React.RefObject<HTMLElement | null>, model: Model | null) {
  useEffect(() => {
    if (!can.multiWindow) return;
    const unlisten = [
      events.tabDrag.listen((e) => {
        const payload = decodeTab(e.payload.payload);
        useIncomingTab.setState({ payload });
        // The drag is over: whatever this window's layout made of it ends.
        if (!payload && container.current) endLayoutDrag(container.current);
      }),
      events.tabAdopted.listen((e) => {
        if (model) void release(model, e.payload.tabId);
      }),
      events.tabSent.listen((e) => {
        const payload = decodeTab(e.payload.payload);
        if (model && payload && payload.workspace === useWorkspace.getState().path) adopt(model, payload);
      }),
    ];
    return () => {
      for (const u of unlisten) void u.then((f) => f());
    };
  }, [container, model]);

  useEffect(() => {
    const el = container.current;
    if (!can.multiWindow || !el || !model) return;
    // The drag under way, until it's over: the page's `dragend`, or the
    // backend seeing the button up (`tabDragEnded`), whichever is first.
    let drag: TabPayload | null = null;

    const finish = async (spot: PointerSpot | null, dropEffect: string) => {
      const payload = drag;
      if (!payload || !spot) return;
      drag = null;
      endLayoutDrag(el);
      log.info(`tab drag ended: ${dropEffect}, inside ${spot.inside}, over ${spot.over}`);
      if (shouldTearOff({ dropEffect, inside: spot.inside, over: spot.over })) {
        await moveTabToNewWindow(model, payload.tabId, { x: spot.at.x ?? 0, y: spot.at.y ?? 0 });
      }
    };

    const onDragEnd = async (e: DragEvent) => {
      // Our own `endLayoutDrag` sends one too, untrusted.
      if (!e.isTrusted) return;
      const dropEffect = e.dataTransfer?.dropEffect ?? 'none';
      await finish(await commands.endTabDrag(), dropEffect);
    };

    const onDragStart = (e: DragEvent) => {
      const button = (e.target as HTMLElement | null)?.closest<HTMLElement>('.flexlayout__tab_button');
      const id = button?.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId;
      const ws = useWorkspace.getState().path;
      if (!button || !id || !ws || !e.isTrusted) return;
      drag = tabPayload(model, id, { source: useAppWindow.getState().label, workspace: ws });
      if (!drag) return;
      void commands.beginTabDrag(encodeTab(drag));
      // On the dragged element itself: flexlayout may take the button out of
      // the page mid-drag, and then `dragend` never reaches the document.
      (e.target as HTMLElement).addEventListener('dragend', onDragEnd, { once: true });
    };

    // flexlayout writes its placeholder text in its React handler, which
    // stops the event there: only a listener on React's own root, added
    // after React's, runs after it.
    const root = el.ownerDocument.getElementById('root');
    const onDragStartAfter = (e: DragEvent) => {
      if (drag && e.dataTransfer) dragData(e.dataTransfer, drag.source);
    };

    const unlisten = events.tabDragEnded.listen((e) => void finish(e.payload.spot, 'none'));
    el.addEventListener('dragstart', onDragStart, true);
    root?.addEventListener('dragstart', onDragStartAfter);
    return () => {
      void unlisten.then((f) => f());
      el.removeEventListener('dragstart', onDragStart, true);
      root?.removeEventListener('dragstart', onDragStartAfter);
    };
  }, [container, model]);
}
