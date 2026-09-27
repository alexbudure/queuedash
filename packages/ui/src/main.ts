import { App } from "./App";

export { App as QueuedashApp };
// A declaration of its own rather than a second export specifier: the rolled-up
// types keep a declaration's JSDoc, and drop a specifier's.
/** @deprecated Use QueuedashApp instead. */
export const QueueDashApp = App;
export type { QueuedashAppProps } from "./App";
export type {
  QueuedashBranding,
  QueuedashTheme,
  QueuedashUiConfig,
} from "@queuedash/api";
