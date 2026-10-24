// @vitest-environment jsdom
import * as React from 'react';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '@sunstead/ui/components/dialog';
import { dragThroughOverlays } from './window-drag';

// @sunstead/ui's JSX is the classic transform.
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

// The real dialog (Base UI's), under the title bar, with the window-drag
// handling installed: what a user's mouse meets.
describe('clicking the title bar while a dialog is open', () => {
  const startDragging = vi.fn(async () => {});
  let root: Root;
  let stop: () => void;
  let header: HTMLElement;
  let overlay: Element;
  let onOpenChange: ReturnType<typeof vi.fn>;
  let onOk: ReturnType<typeof vi.fn>;

  const mouse = (type: string, target: Element, init: MouseEventInit = {}) =>
    act(async () => {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...init }),
      );
    });
  const pointer = (type: string, target: Element) =>
    act(async () => {
      target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true }),
      );
    });
  const clickOn = async (target: Element) => {
    await pointer('pointerdown', target);
    await mouse('mousedown', target);
    await pointer('pointerup', target);
    await mouse('mouseup', target);
    await mouse('click', target, { buttons: 0 });
  };

  beforeEach(async () => {
    header = document.createElement('header');
    header.setAttribute('data-tauri-drag-region', '');
    document.body.append(header);
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onOpenChange = vi.fn();
    onOk = vi.fn();
    await act(async () => {
      root.render(
        h(
          Dialog,
          { open: true, onOpenChange },
          h(
            DialogContent,
            null,
            h(DialogTitle, null, 'Title'),
            h('button', { id: 'ok', onClick: onOk }, 'OK'),
          ),
        ),
      );
    });
    overlay = document.querySelector('[data-slot=dialog-overlay]')!;
    document.elementsFromPoint = () => [overlay, header, document.body];
    stop = dragThroughOverlays(() => ({ startDragging, toggleMaximize: async () => {} }));
  });

  afterEach(async () => {
    stop();
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('closes the dialog, as a click outside it does, and starts no drag', async () => {
    await clickOn(overlay);
    expect(startDragging).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it('leaves the dialog working after the window has been dragged', async () => {
    await pointer('pointerdown', overlay);
    await mouse('mousedown', overlay, { clientX: 100, clientY: 20 });
    await mouse('mousemove', overlay, { clientX: 140, clientY: 20 });
    expect(startDragging).toHaveBeenCalledOnce();
    // The system took the mouse-up: none of pointerup, mouseup or click comes.
    await act(async () => {});

    expect(onOpenChange).not.toHaveBeenCalled();
    await clickOn(document.getElementById('ok')!);
    expect(onOk).toHaveBeenCalledOnce();
  });

  it('still closes on a click outside, after a drag', async () => {
    await pointer('pointerdown', overlay);
    await mouse('mousedown', overlay, { clientX: 100, clientY: 20 });
    await mouse('mousemove', overlay, { clientX: 140, clientY: 20 });
    await act(async () => {});

    document.elementsFromPoint = () => [overlay, document.body];
    await clickOn(overlay);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
