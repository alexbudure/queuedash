import {
  AlertTriangle,
  Clock,
  Info,
  Layers,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { JSONTree } from "react-json-tree";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { JobActionMenu } from "./JobActionMenu";
import { JobTimeline } from "./JobTimeline";
import { SidePanelDialog } from "./SidePanelDialog";

type JobModalProps = {
  job: Job;
  onDismiss: () => void;
  queueName: string;
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

const isEmptyData = (data: unknown): boolean => {
  if (data === null || data === undefined) return true;
  if (typeof data === "object" && Object.keys(data as object).length === 0) {
    return true;
  }
  return false;
};

const formatDuration = (durationMs: number) => {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${(durationMs / 60000).toFixed(2)}m`;
};

const formatDate = (value: Date | null) => {
  if (!value) return "-";
  return value.toLocaleString();
};

const readNumber = (value: unknown): number | null => {
  return typeof value === "number" ? value : null;
};

const readString = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

const readBoolean = (value: unknown): boolean | null => {
  return typeof value === "boolean" ? value : null;
};

const getProgress = (job: Job, parsedData: unknown) => {
  if (typeof job.progress === "number") return job.progress;

  if (
    parsedData &&
    typeof parsedData === "object" &&
    "progress" in parsedData &&
    typeof (parsedData as Record<string, unknown>).progress === "number"
  ) {
    return (parsedData as Record<string, unknown>).progress as number;
  }

  return null;
};

const getBackoffLabel = (value: unknown) => {
  if (!value) return null;

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const type = readString(objectValue.type);
    const delay = readNumber(objectValue.delay);

    if (type && delay !== null) {
      return `${type} (${delay}ms)`;
    }

    if (type) {
      return type;
    }
  }

  return null;
};

export const JobModal = ({ job, queueName, onDismiss }: JobModalProps) => {
  const [showOpts, setShowOpts] = useState(false);
  const [showFullError, setShowFullError] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showStacktrace, setShowStacktrace] = useState(false);
  const isDark = useDarkMode();
  const jsonTreeTheme = isDark ? jsonTreeDarkTheme : jsonTreeLightTheme;

  const queueReq = trpc.queue.byName.useQuery({
    queueName,
  });
  const { data: logs } = trpc.job.logs.useQuery({
    jobId: job.id,
    queueName,
  });

  const parsedData = useMemo(() => {
    const data = parseUnknownJson(job.data);
    return isEmptyData(data) ? null : data;
  }, [job.data]);

  const parsedReturnValue = useMemo(() => {
    const returnValue = parseUnknownJson(job.returnValue);
    return isEmptyData(returnValue) ? null : returnValue;
  }, [job.returnValue]);

  const parsedOpts = useMemo(() => {
    const opts = parseUnknownJson(job.opts);

    if (!opts || typeof opts !== "object") {
      return null;
    }

    return opts as Record<string, unknown>;
  }, [job.opts]);

  const duration =
    job.processedAt && job.finishedAt
      ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
      : null;
  const progress = getProgress(job, parsedData);

  const optionBadges = useMemo(() => {
    if (!parsedOpts) return [];

    const options: Array<{
      key: string;
      label: string;
      value: string;
      icon: ReactNode;
      description: string;
    }> = [];

    const delay = readNumber(parsedOpts.delay);
    if (delay !== null) {
      options.push({
        key: "delay",
        label: "Delay",
        value: `${delay}ms`,
        icon: <Clock className="size-3" />,
        description: "Job will be delayed before processing",
      });
    }

    const attempts = readNumber(parsedOpts.attempts);
    if (attempts !== null && attempts > 1) {
      options.push({
        key: "attempts",
        label: "Attempts",
        value: String(attempts),
        icon: <RotateCw className="size-3" />,
        description: "Maximum number of retry attempts",
      });
    }

    const backoff = getBackoffLabel(parsedOpts.backoff);
    if (backoff) {
      options.push({
        key: "backoff",
        label: "Backoff",
        value: backoff,
        icon: <RotateCcw className="size-3" />,
        description: "Retry strategy for failed jobs",
      });
    }

    const removeOnComplete = readBoolean(parsedOpts.removeOnComplete);
    if (removeOnComplete !== null) {
      options.push({
        key: "removeOnComplete",
        label: "Remove on Complete",
        value: removeOnComplete ? "Yes" : "No",
        icon: <Trash2 className="size-3" />,
        description: "Auto-remove job when completed",
      });
    }

    const removeOnFail = readBoolean(parsedOpts.removeOnFail);
    if (removeOnFail !== null) {
      options.push({
        key: "removeOnFail",
        label: "Remove on Fail",
        value: removeOnFail ? "Yes" : "No",
        icon: <Trash2 className="size-3" />,
        description: "Auto-remove job when failed",
      });
    }

    const timeout = readNumber(parsedOpts.timeout);
    if (timeout !== null) {
      options.push({
        key: "timeout",
        label: "Timeout",
        value: `${timeout}ms`,
        icon: <Clock className="size-3" />,
        description: "Maximum job execution time",
      });
    }

    return options;
  }, [parsedOpts]);

  return (
    <SidePanelDialog
      title={job.name}
      subtitle={job.id}
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      headerActions={
        <JobActionMenu
          job={job}
          queueName={queueName}
          queue={queueReq.data ?? undefined}
          onRemove={onDismiss}
        />
      }
    >
      <div className="space-y-6 p-6">
        {progress !== null && job.processedAt && !job.finishedAt ? (
          <div className="rounded-lg bg-gray-50/80 px-3 py-2.5 dark:bg-slate-800/40">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-1.5 animate-pulse rounded-full bg-gray-900 dark:bg-slate-100" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Processing
                </span>
              </div>
              <span className="font-mono text-xs font-medium text-gray-500 dark:text-slate-400">
                {progress}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-gray-200/60 dark:bg-slate-700/60">
              <div
                className="h-full rounded-full bg-gray-900 transition-all duration-500 dark:bg-slate-100"
                style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
              />
            </div>
          </div>
        ) : null}

        <JobTimeline job={job} />

        {optionBadges.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Options
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {optionBadges.map((option) => (
                <div
                  key={option.key}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gray-100/80 px-2.5 py-1 text-xs text-gray-600 dark:bg-slate-800/60 dark:text-slate-400"
                  title={option.description}
                >
                  {option.icon}
                  <span>{option.label}:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {option.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {job.retriedAt ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-orange-50/80 px-3 py-2.5 dark:bg-orange-950/20">
            <RotateCw className="size-3.5 shrink-0 text-orange-500 dark:text-orange-400" />
            <div className="flex-1 text-xs text-orange-800 dark:text-orange-300/90">
              <span className="font-medium">Retried</span>{" "}
              {new Date(job.retriedAt).toLocaleString()}
              {parsedOpts && readNumber(parsedOpts.attempts)
                ? ` · Max ${readNumber(parsedOpts.attempts)} attempts`
                : null}
            </div>
          </div>
        ) : null}

        {job.failedReason ? (
          <div className="rounded-lg bg-red-50/80 p-3 dark:bg-red-950/20">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500 dark:text-red-400" />
              <div className="flex-1 min-w-0">
                <p className="mb-1.5 text-xs font-medium text-red-800 dark:text-red-300">
                  Failed Reason
                </p>
                <pre className="overflow-wrap-anywhere whitespace-pre-wrap break-all font-mono text-xs text-red-700/90 dark:text-red-400/80">
                  {showFullError || job.failedReason.length <= 300
                    ? job.failedReason
                    : `${job.failedReason.slice(0, 300)}...`}
                </pre>
                {job.failedReason.length > 300 ? (
                  <button
                    onClick={() => setShowFullError((prev) => !prev)}
                    className="mt-1.5 text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {showFullError ? "Show less" : "Show more"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Details
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailItem
              label="Queue"
              value={queueReq.data?.displayName ?? queueName}
            />

            {job.groupId ? (
              <DetailItem
                label="Group"
                value={
                  <span className="flex items-center gap-1.5">
                    <Layers className="size-3 text-purple-500" />
                    <span className="font-mono">{job.groupId}</span>
                  </span>
                }
              />
            ) : null}

            {parsedOpts && readNumber(parsedOpts.priority) !== null ? (
              <DetailItem
                label="Priority"
                value={
                  <span className="font-mono">
                    {readNumber(parsedOpts.priority)}
                  </span>
                }
              />
            ) : null}

            {job.attemptsMade != null && job.attemptsMade > 0 ? (
              <DetailItem
                label="Attempt"
                value={
                  <span className="font-mono">
                    {job.attemptsMade}
                    {parsedOpts && readNumber(parsedOpts.attempts)
                      ? ` / ${readNumber(parsedOpts.attempts)}`
                      : null}
                  </span>
                }
              />
            ) : null}

            <DetailItem
              label="Added At"
              value={formatDate(job.createdAt ? new Date(job.createdAt) : null)}
            />

            {job.processedAt ? (
              <DetailItem
                label="Processed At"
                value={new Date(job.processedAt).toLocaleString()}
              />
            ) : null}

            {job.finishedAt ? (
              <DetailItem
                label="Finished At"
                value={new Date(job.finishedAt).toLocaleString()}
              />
            ) : null}

            {duration !== null ? (
              <DetailItem
                label="Duration"
                value={
                  <span className="font-mono">{formatDuration(duration)}</span>
                }
              />
            ) : null}
          </div>
        </div>

        {parsedData ? (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Job Data
            </h3>
            <div className="data-json-renderer overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
              <JSONTree
                data={parsedData}
                theme={jsonTreeTheme}
                invertTheme={false}
                hideRoot
                shouldExpandNodeInitially={() => true}
              />
            </div>
          </div>
        ) : null}

        {parsedReturnValue !== null ? (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Return Value
            </h3>
            <div className="data-json-renderer overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
              <JSONTree
                data={parsedReturnValue}
                theme={jsonTreeTheme}
                invertTheme={false}
                hideRoot
                shouldExpandNodeInitially={() => true}
              />
            </div>
          </div>
        ) : null}

        {queueReq.data?.supports.logs && logs && logs.length > 0 ? (
          <div>
            <button
              onClick={() => setShowLogs((prev) => !prev)}
              className="mb-2 flex w-full items-center justify-between"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Logs
              </span>
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {showLogs ? "Collapse" : "Expand"}
              </span>
            </button>
            {showLogs ? (
              <div className="overflow-x-auto rounded-lg bg-gray-900 p-3 dark:bg-slate-950">
                <div className="space-y-0.5">
                  {(logs as string[]).map((line: string, index: number) => (
                    <div
                      key={index}
                      className="whitespace-pre-wrap break-all font-mono text-xs text-gray-300"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {job.stacktrace && job.stacktrace.length > 0 ? (
          <div>
            <button
              onClick={() => setShowStacktrace((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
            >
              <Info className="size-3" />
              <span>{showStacktrace ? "Hide" : "Show"} stack trace</span>
            </button>
            {showStacktrace ? (
              <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 p-3 dark:border-slate-800/60 dark:bg-slate-900/50">
                <div className="space-y-0.5">
                  {job.stacktrace.map((line: string, index: number) => (
                    <div
                      key={index}
                      className="whitespace-pre-wrap break-all font-mono text-xs text-gray-500 dark:text-slate-400"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {parsedOpts && Object.keys(parsedOpts).length > 0 ? (
          <div>
            <button
              onClick={() => setShowOpts((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
            >
              <Info className="size-3" />
              <span>{showOpts ? "Hide" : "Show"} raw options</span>
            </button>
            {showOpts ? (
              <div className="data-json-renderer mt-2 overflow-x-auto rounded-lg border border-gray-100/60 bg-gray-50/50 text-xs dark:border-slate-800/60 dark:bg-slate-900/50">
                <JSONTree
                  data={parsedOpts}
                  theme={jsonTreeTheme}
                  invertTheme={false}
                  hideRoot
                  shouldExpandNodeInitially={() => true}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SidePanelDialog>
  );
};

const DetailItem = ({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) => (
  <div>
    <p className="mb-0.5 text-xs text-gray-400 dark:text-slate-500">{label}</p>
    <p className="text-sm text-gray-900 dark:text-white">{value}</p>
  </div>
);
