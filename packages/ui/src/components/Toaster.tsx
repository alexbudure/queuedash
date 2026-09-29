import { clsx } from "clsx";
import {
  AlertTriangle,
  CheckCircle,
  CircleX,
  Info,
  Loader2,
} from "lucide-react";
import {
  Toaster as SonnerToaster,
  type ToastClassnames,
  type ToasterProps,
} from "sonner";

import { OVERLAY_SURFACE, TEXT_MUTED } from "../utils/styles";

/**
 * Sonner's own toast styles lost to the dashboard's scoped reset. That reset is
 * `[data-queuedash-root]` three times over `*`, (0,3,0), while sonner styles a
 * toast with `[data-sonner-toast][data-styled=true]`, (0,2,0) - so every toast
 * rendered with no padding, border or icon margins, and its buttons lost their
 * fill to the reset's `button` rule. Unstyled toasts take their whole look from
 * the classes below instead, which are scoped like the rest of the dashboard
 * and win the same way.
 */

const ICON_CLASS = "size-4";

// Icons share the status vocabulary: the ones the job table uses for completed
// and failed, the one ErrorCard uses for warnings. Glyphs sit a step darker
// than status text so they keep 3:1 against the surface.
const TOAST_ICONS: ToasterProps["icons"] = {
  success: (
    <CheckCircle
      aria-hidden="true"
      className={clsx(ICON_CLASS, "text-green-600 dark:text-green-400")}
    />
  ),
  error: (
    <CircleX
      aria-hidden="true"
      className={clsx(ICON_CLASS, "text-red-600 dark:text-red-400")}
    />
  ),
  warning: (
    <AlertTriangle
      aria-hidden="true"
      className={clsx(ICON_CLASS, "text-amber-600 dark:text-amber-400")}
    />
  ),
  info: <Info aria-hidden="true" className={clsx(ICON_CLASS, TEXT_MUTED)} />,
  loading: (
    <Loader2
      aria-hidden="true"
      className={clsx(ICON_CLASS, "animate-spin", TEXT_MUTED)}
    />
  ),
};

const TOAST_CLASS_NAMES: ToastClassnames = {
  // Sonner only sizes a toast from `--width` in its styled mode. At 600px and
  // below it stretches toasts across the screen itself, so the width applies
  // from 601px up. `font-sans` because the toaster sets its own system stack.
  toast: clsx(
    OVERLAY_SURFACE,
    "flex items-start gap-2.5 px-3.5 py-3 font-sans text-sm text-gray-900 min-[601px]:w-[var(--width)] dark:text-white",
  ),
  icon: "mt-0.5 flex shrink-0",
  content: "min-w-0 flex-1",
  title: "leading-5",
  description: clsx("mt-0.5 leading-5", TEXT_MUTED),
  // The small outline button. The toast is an overlay, so in dark mode it
  // sits on slate-800 rather than the slate-900 that Button is drawn for.
  actionButton:
    "inline-flex h-7 shrink-0 cursor-pointer items-center self-center rounded-full border border-gray-200 bg-white px-3 text-xs font-medium whitespace-nowrap text-gray-700 transition-colors duration-150 outline-none hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:focus-visible:ring-brand-600 dark:focus-visible:ring-offset-slate-800 dark:active:bg-slate-600",
};

type ToasterPropsWithTheme = {
  isDark: boolean;
};

export const Toaster = ({ isDark }: ToasterPropsWithTheme) => (
  // A modal dialog makes everything outside it inert, and toasts render outside
  // every dialog: "Discard your changes?" appeared over the Add job panel with
  // a Discard button nothing could click. react-aria leaves top-layer nodes
  // alone, as it does for its own toasts.
  <div data-react-aria-top-layer="true">
    <SonnerToaster
      theme={isDark ? "dark" : "light"}
      position="bottom-right"
      // On large screens the page panel stops 12px above the bottom of the
      // window and 16px from its right edge, which left toasts 8px inside the
      // panel's corner. This keeps them 16px in on both sides.
      offset={{ bottom: 28, right: 32 }}
      icons={TOAST_ICONS}
      toastOptions={{ unstyled: true, classNames: TOAST_CLASS_NAMES }}
    />
  </div>
);
