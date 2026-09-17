import {
  CheckCircle,
  CircleArrowUp,
  CirclePause,
  CircleX,
  Clock,
  GitFork,
  type LucideIcon,
  Timer,
  Zap,
} from "lucide-react";

import type { Status } from "./trpc";

/** The order every status list in the dashboard uses. */
export const STATUS_ORDER: readonly Status[] = [
  "completed",
  "failed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "delayed",
  "paused",
];

export const STATUS_LABELS: Record<Status, string> = {
  completed: "Completed",
  failed: "Failed",
  active: "Active",
  prioritized: "Prioritized",
  waiting: "Waiting",
  "waiting-children": "Waiting children",
  delayed: "Delayed",
  paused: "Paused",
};

export const STATUS_ICONS: Record<Status, LucideIcon> = {
  completed: CheckCircle,
  failed: CircleX,
  active: Zap,
  prioritized: CircleArrowUp,
  waiting: Clock,
  "waiting-children": GitFork,
  delayed: Timer,
  paused: CirclePause,
};

/** Tinted text on a tinted fill - the one way a status wears its colour. */
export const STATUS_TINT: Record<Status, string> = {
  completed:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-400",
  failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400",
  active:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-400",
  prioritized:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-400",
  waiting:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400",
  "waiting-children":
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-400",
  delayed:
    "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-400",
  paused:
    "border-gray-200 bg-gray-100 text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
};
