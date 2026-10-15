// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "@/styles/app.css";
import { trackPointerKind } from "@/lib/pointer-kind";
import { touchFirst } from "@/lib/backend/platform";

// Safari (the web app on an iPad) zooms the page on a pinch whatever the
// viewport says. Boards and the image viewer pinch with pointer events,
// which this leaves alone.
document.addEventListener("gesturestart", (e) => e.preventDefault());

// Which pointer hovers: the Pencil and a trackpad do, a finger doesn't.
trackPointerKind();

// Touch first: the controls a finger hits most grow (sunstead-ui's `touch:`
// variant). Decided once, so a trackpad coming and going moves nothing.
if (touchFirst) document.documentElement.dataset.touch = "";

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