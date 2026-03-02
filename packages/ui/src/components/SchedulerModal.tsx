import cronstrue from "cronstrue";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Calendar, Clock, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { JSONTree } from "react-json-tree";
import type { Scheduler } from "../utils/trpc";
import { SchedulerActionMenu } from "./SchedulerActionMenu";
import { SidePanelDialog } from "./SidePanelDialog";

type SchedulerModalProps = {
  scheduler: Scheduler;
  queueName: string;
  onDismiss: () => void;
};

const jsonTreeLightTheme = {
  scheme: "light",
  author: "queuedash",
  base00: "#f8fafc",
  base01: "#f1f5f9",
  base02: "#e2e8f0",
  base03: "#64748b",
  base04: "#94a3b8",
  base05: "#171717",
  base06: "#0a0a0a",
  base07: "#000000",
  base08: "#dc2626",
  base09: "#ea580c",
  base0A: "#ca8a04",
  base0B: "#16a34a",
  base0C: "#0891b2",
  base0D: "#2563eb",
  base0E: "#9333ea",
  base0F: "#be185d",
};

const jsonTreeDarkTheme = {
  scheme: "dark",
  author: "queuedash",
  base00: "#0f172a",
  base01: "#1e293b",
  base02: "#334155",
  base03: "#64748b",
  base04: "#94a3b8",
  base05: "#e2e8f0",
  base06: "#f1f5f9",
  base07: "#f8fafc",
  base08: "#f87171",
  base09: "#fb923c",
  base0A: "#facc15",
  base0B: "#4ade80",
  base0C: "#22d3ee",
  base0D: "#60a5fa",
  base0E: "#c084fc",
  base0F: "#f472b6",
};

const useDarkMode = () => {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
};

const parseUnknownJson = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const isEmptyData = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "object" && Object.keys(value as object).length === 0) {
    return true;
  }
  return false;
};

const getScheduleLabel = (scheduler: Scheduler) => {
  if (scheduler.pattern) {
    try {
      return cronstrue.toString(scheduler.pattern, { verbose: true });
    } catch {
      return scheduler.pattern;
    }
  }

  if (scheduler.every) {
    const seconds = scheduler.every / 1000;
    if (seconds < 60) return `Every ${seconds}s`;
    if (seconds < 3600) return `Every ${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `Every ${Math.floor(seconds / 3600)}h`;
    return `Every ${Math.floor(seconds / 86400)}d`;
  }

  return "No schedule configured";
};

const formatDate = (value?: number | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString();
};

const formatEvery = (every?: number) => {
  if (!every) return "-";
  const seconds = every / 1000;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

export const SchedulerModal = ({
  scheduler,
  queueName,
  onDismiss,
}: SchedulerModalProps) => {
  const [showRawDetails, setShowRawDetails] = useState(false);
  const isDark = useDarkMode();
  const jsonTreeTheme = isDark ? jsonTreeDarkTheme : jsonTreeLightTheme;

  const scheduleLabel = useMemo(() => getScheduleLabel(scheduler), [scheduler]);

  const templateData = useMemo(() => {
    const parsed = parseUnknownJson(scheduler.template?.data);
    return isEmptyData(parsed) ? null : parsed;
  }, [scheduler.template]);

  const templateOpts = useMemo(() => {
    const rawTemplate = scheduler.template as
      | Record<string, unknown>
      | undefined;
    const parsed = parseUnknownJson(rawTemplate?.opts);
    return isEmptyData(parsed) ? null : parsed;
  }, [scheduler.template]);

  const schedulerDetails = useMemo(() => {
    const details = { ...scheduler } as Record<string, unknown>;
    delete details.template;
    return details;
  }, [scheduler]);

  const nextRunDate = scheduler.next ? new Date(scheduler.next) : null;

  return (
    <SidePanelDialog
      title={scheduler.name}
      subtitle={scheduler.id ?? scheduler.key}
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      headerActions={
        <SchedulerActionMenu
          queueName={queueName}
          scheduler={scheduler}
          onRemove={onDismiss}
        />
      }
    >
      <div className="space-y-6 p-6">
        <div className="rounded-lg bg-gray-50/80 p-3.5 dark:bg-slate-800/40">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                <Clock className="size-3" />
                Schedule
              </p>
              <p className="mt-1.5 text-sm font-medium text-gray-900 dark:text-white">
                {scheduleLabel}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-slate-700/60 dark:text-slate-400">
              {scheduler.pattern
                ? "Cron"
                : scheduler.every
                  ? "Interval"
                  : "Unscheduled"}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {scheduler.pattern ? (
              <span className="inline-flex items-center rounded-full bg-blue-50/80 px-2.5 py-0.5 font-mono text-xs text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                {scheduler.pattern}
              </span>
            ) : null}
            {scheduler.every ? (
              <span className="inline-flex items-center rounded-full bg-blue-50/80 px-2.5 py-0.5 text-xs text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                Every {formatEvery(scheduler.every)}
              </span>
            ) : null}
            {scheduler.tz ? (
              <span className="inline-flex items-center rounded-full bg-gray-100/80 px-2.5 py-0.5 text-xs text-gray-500 dark:bg-slate-700/60 dark:text-slate-400">
                {scheduler.tz}
              </span>
            ) : null}
          </div>
        </div>

        {nextRunDate ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-blue-50/80 px-3 py-2.5 dark:bg-blue-950/20">
            <Calendar className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
            <div className="min-w-0 flex-1 text-xs">
              <span className="font-medium text-blue-800 dark:text-blue-300">
                Next run{" "}
                {formatDistanceToNow(nextRunDate, { addSuffix: true })}
              </span>
              <span className="ml-1.5 text-blue-600/70 dark:text-blue-400/60">
                · {formatDate(scheduler.next)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg bg-amber-50/80 px-3 py-2.5 dark:bg-amber-950/20">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
              No next run scheduled
            </span>
          </div>
        )}

        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Details
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailItem label="Queue" value={queueName} />
            <DetailItem label="Key" value={scheduler.key} mono />
            <DetailItem label="ID" value={scheduler.id ?? "-"} mono />
            <DetailItem
              label="Total Runs"
              value={
                scheduler.iterationCount !== undefined
                  ? String(scheduler.iterationCount)
                  : "-"
              }
              mono
            />
            <DetailItem
              label="Limit"
              value={
                scheduler.limit !== undefined
                  ? String(scheduler.limit)
                  : "No limit"
              }
              mono
            />
            <DetailItem label="End Date" value={formatDate(scheduler.endDate)} />
          </div>
        </div>

        {templateData ? (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Job Data
            </h3>
            <div className="data-json-renderer overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
              <JSONTree
                data={templateData}
                theme={jsonTreeTheme}
                invertTheme={false}
                hideRoot
                shouldExpandNodeInitially={() => true}
              />
            </div>
          </div>
        ) : null}

        {templateOpts ? (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Job Options
            </h3>
            <div className="data-json-renderer overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
              <JSONTree
                data={templateOpts}
                theme={jsonTreeTheme}
                invertTheme={false}
                hideRoot
                shouldExpandNodeInitially={() => true}
              />
            </div>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
            onClick={() => setShowRawDetails((prev) => !prev)}
          >
            <Info className="size-3" />
            <span>
              {showRawDetails ? "Hide" : "Show"} raw scheduler options
            </span>
          </button>
          {showRawDetails ? (
            <div className="data-json-renderer mt-2 overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
              <JSONTree
                data={schedulerDetails}
                theme={jsonTreeTheme}
                invertTheme={false}
                hideRoot
                shouldExpandNodeInitially={() => true}
              />
            </div>
          ) : null}
        </div>
      </div>
    </SidePanelDialog>
  );
};

const DetailItem = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div>
    <p className="mb-0.5 text-xs text-gray-400 dark:text-slate-500">{label}</p>
    <p
      className={`break-all text-sm text-gray-900 dark:text-white ${mono ? "font-mono" : ""}`}
    >
      {value}
    </p>
  </div>
);
