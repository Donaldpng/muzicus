import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/unbounded/cyrillic-600.css";
import "@fontsource/unbounded/cyrillic-700.css";
import "@fontsource/unbounded/latin-600.css";
import "@fontsource/unbounded/latin-700.css";
import "@fontsource/manrope/cyrillic-400.css";
import "@fontsource/manrope/cyrillic-600.css";
import "@fontsource/manrope/cyrillic-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/cyrillic-500.css";
import segUrl from "dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2?url";
import "./styles.css";
import App from "./App";
import { initApi } from "./lib/api";
import { loadLibrary } from "./store/library";
import { loadSettings } from "./store/settings";

const seg = new FontFace("DSEG7", `url(${segUrl})`, { weight: "700" });
seg.load().then((f) => document.fonts.add(f)).catch(() => {});

(async () => {
  await initApi();
  await Promise.all([loadSettings(), loadLibrary()]);
  if (import.meta.env.DEV) {
    const [{ usePlayer }, { useLib }, { useUi }, { engine }] = await Promise.all([
      import("./store/player"),
      import("./store/library"),
      import("./store/ui"),
      import("./audio/engine"),
    ]);
    (window as any).__muz = { usePlayer, useLib, useUi, engine };
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
})();
