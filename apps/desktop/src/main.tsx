// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "@/styles/app.css";
import { trackPointerKind } from "@/lib/pointer-kind";
import { can, touchFirst } from "@/lib/backend/platform";
import { getCurrentWindow } from "@/lib/backend/window";
import { dragThroughOverlays } from "@/lib/window-drag";
import { followPencilTaps } from "@/lib/pencil-taps";

// Safari (the web app on an iPad) zooms the page on a pinch whatever the
// viewport says. Boards and the image viewer pinch with pointer events,
// which this leaves alone.
document.addEventListener("gesturestart", (e) => e.preventDefault());

// Which pointer hovers: the Pencil and a trackpad do, a finger doesn't.
trackPointerKind();

// Touch first: the controls a finger hits most grow (sunstead-ui's `touch:`
// variant). Decided once, so a trackpad coming and going moves nothing.
if (touchFirst) document.documentElement.dataset.touch = "";

// The title bar still drags the window while a dialog's overlay covers it.
if (can.windowChrome) dragThroughOverlays(getCurrentWindow);

// Quick Pencil taps a system gesture kept from WebKit still land.
if (can.nativeViews) followPencilTaps();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);