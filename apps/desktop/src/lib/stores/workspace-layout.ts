import type { IJsonModel } from 'flexlayout-react';
import { getScopedStore } from './scoped-storage';
import { layoutFileFor, useAppWindow } from './app-window';

const LAYOUT_KEY = 'layout';

/** Each editor window keeps its own tabs; the full window has `layout.json`. */
const layoutFile = () => layoutFileFor(useAppWindow.getState());

export async function getStoredLayout(): Promise<IJsonModel | null> {
  const store = await getScopedStore(layoutFile());
  return (await store.get<IJsonModel>(LAYOUT_KEY)) ?? null;
}

export async function setStoredLayout(json: IJsonModel) {
  const store = await getScopedStore(layoutFile());
  await store.set(LAYOUT_KEY, json);
}