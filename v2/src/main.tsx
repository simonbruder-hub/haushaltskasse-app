import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
// Daten dauerhaft speichern: der Browser soll sie nicht bei Platzmangel löschen
navigator.storage?.persist?.().catch(() => undefined);
