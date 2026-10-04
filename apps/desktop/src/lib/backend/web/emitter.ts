import type { EventSource } from '../index';

/** An event source the web backend raises itself, shaped like Tauri's. */
export class Emitter<T> implements EventSource<T> {
  private handlers = new Set<(event: { payload: T }) => void>();

  listen(handler: (event: { payload: T }) => void): Promise<() => void> {
    this.handlers.add(handler);
    return Promise.resolve(() => {
      this.handlers.delete(handler);
    });
  }

  emit(payload: T) {
    for (const handler of [...this.handlers]) handler({ payload });
  }
}
