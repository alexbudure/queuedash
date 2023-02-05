import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { App } from "./App";

export { App as QueueDashApp } from "./App";
interface CustomWindow extends Window {
  __INITIAL_STATE__: {
    apiUrl: string;
    basename: string;
  };
}

declare let window: CustomWindow;

export function mountQueueDashApp() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App
        apiUrl={window.__INITIAL_STATE__.apiUrl}
        basename={window.__INITIAL_STATE__.basename}
      />
    </StrictMode>
  );
}
