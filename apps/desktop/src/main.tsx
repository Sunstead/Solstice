// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "@/styles/app.css";

// Safari (the web app on an iPad) zooms the page on a pinch whatever the
// viewport says. Boards and the image viewer pinch with pointer events,
// which this leaves alone.
document.addEventListener("gesturestart", (e) => e.preventDefault());

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