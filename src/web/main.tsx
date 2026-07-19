/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./app.css";

const SW_UPDATE_INTERVAL_MS = 60_000;

// autoUpdate + skipWaiting means a new SW takes control mid-session without a
// navigation — but the old bundles keep running. Reload once when control
// changes so installed-PWA users pick up the new build. `hadController`
// distinguishes an update (reload) from the very first install (don't), and
// `reloading` guards against controllerchange firing more than once.
if ("serviceWorker" in navigator) {
  let hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    // iOS resumes a suspended PWA without re-navigating, so the browser never
    // checks for a new SW on its own — poll while the app is open.
    if (registration) {
      setInterval(() => {
        registration.update().catch(() => {});
      }, SW_UPDATE_INTERVAL_MS);
    }
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
