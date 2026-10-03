import type { IJsonModel } from 'flexlayout-react';
import { getScopedStore } from './scoped-storage';

const LAYOUT_FILE = 'layout.json';
const LAYOUT_KEY = 'layout';

export async function getStoredLayout(): Promise<IJsonModel | null> {
  const store = await getScopedStore(LAYOUT_FILE);
  return (await store.get<IJsonModel>(LAYOUT_KEY)) ?? null;
}

export async function setStoredLayout(json: IJsonModel) {
  const store = await getScopedStore(LAYOUT_FILE);
  await store.set(LAYOUT_KEY, json);
}