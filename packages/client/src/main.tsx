import type { QueuedashUiConfig } from "@queuedash/ui";
import { QueuedashApp } from "@queuedash/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

interface CustomWindow extends Window {
  __INITIAL_STATE__: {
    apiUrl: string;
    auth?: {
      baseUrl: string;
    };
    basename: string;
    ui?: QueuedashUiConfig;
  };
}

declare let window: CustomWindow;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueuedashApp
      apiUrl={window.__INITIAL_STATE__.apiUrl}
      auth={window.__INITIAL_STATE__.auth}
      basename={window.__INITIAL_STATE__.basename}
      ui={window.__INITIAL_STATE__.ui}
    />
  </StrictMode>,
);
