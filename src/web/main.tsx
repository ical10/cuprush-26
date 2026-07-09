import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Sandbox } from "./sandbox/Sandbox";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./app.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Check if sandbox is requested in query params or hash
const isSandbox = typeof window !== "undefined" && (
  window.location.search.includes("sandbox") ||
  window.location.hash.includes("sandbox")
);

createRoot(rootElement).render(
  <StrictMode>
    {isSandbox ? <Sandbox /> : <App />}
  </StrictMode>,
);

