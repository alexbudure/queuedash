import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { QueueDashApp } from "@queuedash/ui";

interface CustomWindow extends Window {
  __INITIAL_STATE__: {
    apiUrl: string;
    basename: string;
  };
}

declare let window: CustomWindow;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueueDashApp
      apiUrl={window.__INITIAL_STATE__.apiUrl}
      basename={window.__INITIAL_STATE__.basename}
    />
  </StrictMode>
);
