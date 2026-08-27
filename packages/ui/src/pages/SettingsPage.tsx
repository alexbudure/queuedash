import type {
  QueuedashDefaultJobStatus,
  QueuedashDensity,
  QueuedashTheme,
  QueuedashTimestampMode,
} from "@queuedash/api";
import { Check, RotateCcw, Shield, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../components/Button";
import { ErrorCard } from "../components/ErrorCard";
import { Layout } from "../components/Layout";
import {
  type UserPreferences,
  useQueuedash,
} from "../components/QueuedashProvider";
import { Select, type SelectOption } from "../components/Select";
import { Timestamp } from "../components/Timestamp";
import { trpc } from "../utils/trpc";
import {
  formatRefreshIntervalLabel,
  getRefreshIntervalOptions,
} from "../utils/viewState";

const THEME_OPTIONS: Array<SelectOption<QueuedashTheme>> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const JOBS_PER_PAGE_OPTIONS = [20, 30, 50, 100].map((value) => ({
  label: String(value),
  value: String(value),
}));

const DENSITY_OPTIONS: Array<SelectOption<QueuedashDensity>> = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
];

const TIMESTAMP_OPTIONS: Array<SelectOption<QueuedashTimestampMode>> = [
  { label: "Relative", value: "relative" },
  { label: "Absolute", value: "absolute" },
];

const TOGGLE_OPTIONS = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

const JOB_STATUS_OPTIONS: Array<{
  label: string;
  value: QueuedashDefaultJobStatus;
}> = [
  { label: "Remember last", value: "remember" },
  { label: "Failed", value: "failed" },
  { label: "Waiting", value: "waiting" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Delayed", value: "delayed" },
  { label: "Prioritized", value: "prioritized" },
  { label: "Waiting children", value: "waiting-children" },
  { label: "Paused", value: "paused" },
];

const ACCESS_MODE_LABELS = {
  full: "Full access",
  hidden: "Hidden",
  "read-only": "Read-only",
} as const;

const PRIVACY_EXPOSURE_LABELS = {
  jobData: "Job data",
  jobOptions: "Job options",
  logs: "Logs",
  returnValues: "Return values",
  schedulerData: "Scheduler data",
  stacktraces: "Stack traces",
} as const;

const getOptionLabel = (
  options: ReadonlyArray<{ label: string; value: string }>,
  value: string,
) => options.find((option) => option.value === value)?.label ?? value;

const SettingRow = ({
  description,
  label,
  children,
}: {
  description: string;
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col justify-between gap-3 border-b border-gray-100 py-4 last:border-b-0 sm:flex-row sm:items-center dark:border-slate-800">
    <div>
      <div className="text-sm font-medium text-gray-900 dark:text-white">
        {label}
      </div>
      <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
        {description}
      </div>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const BooleanState = ({
  enabled,
  falseLabel = "Hidden",
  trueLabel = "Exposed",
}: {
  enabled: boolean;
  falseLabel?: string;
  trueLabel?: string;
}) => (
  <span
    className={`inline-flex items-center gap-1.5 text-sm ${
      enabled
        ? "text-green-700 dark:text-green-400"
        : "text-gray-400 dark:text-slate-500"
    }`}
  >
    {enabled ? <Check className="size-3.5" /> : <X className="size-3.5" />}
    {enabled ? trueLabel : falseLabel}
  </span>
);

export const SettingsPage = () => {
  const {
    branding,
    defaultPreferences,
    preferenceScope,
    preferences,
    resetPreferences,
    setDefaultJobStatus,
    setDensity,
    setJobsPerPage,
    setRefreshInterval,
    setShowOverviewMetrics,
    setTheme,
    setTimestamps,
  } = useQueuedash();
  const server = trpc.settings.get.useQuery();

  return (
    <Layout>
      <div className="max-w-3xl">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Dashboard overrides stay in this browser. Server policy is read-only
            here and cannot be bypassed by local settings.
          </p>
        </div>

        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-slate-500">
            My dashboard
          </h2>
          <div className="mt-2 rounded-xl border border-gray-100 px-4 dark:border-slate-800">
            <SettingRow
              label="Appearance"
              description={`Server default: ${getOptionLabel(
                THEME_OPTIONS,
                defaultPreferences.theme,
              )}`}
            >
              <Select
                ariaLabel="Appearance"
                options={THEME_OPTIONS}
                value={preferences.theme}
                onChange={setTheme}
              />
            </SettingRow>

            <SettingRow
              label="Auto-refresh"
              description={`Server default: ${formatRefreshIntervalLabel(
                defaultPreferences.refreshIntervalMs,
              )}`}
            >
              <Select
                ariaLabel="Auto-refresh"
                options={getRefreshIntervalOptions(
                  preferences.refreshIntervalMs,
                  defaultPreferences.refreshIntervalMs,
                )}
                value={
                  preferences.refreshIntervalMs === false
                    ? "off"
                    : String(preferences.refreshIntervalMs)
                }
                onChange={(value) =>
                  setRefreshInterval(value === "off" ? false : Number(value))
                }
              />
            </SettingRow>

            <SettingRow
              label="Jobs per load"
              description={`Server default: ${defaultPreferences.jobsPerPage}`}
            >
              <Select
                ariaLabel="Jobs per load"
                options={JOBS_PER_PAGE_OPTIONS}
                value={String(preferences.jobsPerPage)}
                onChange={(value) =>
                  setJobsPerPage(
                    Number(value) as UserPreferences["jobsPerPage"],
                  )
                }
              />
            </SettingRow>

            <SettingRow
              label="Default job tab"
              description={`Server default: ${getOptionLabel(
                JOB_STATUS_OPTIONS,
                defaultPreferences.defaultJobStatus,
              )}`}
            >
              <Select
                ariaLabel="Default job tab"
                options={JOB_STATUS_OPTIONS}
                value={preferences.defaultJobStatus}
                onChange={setDefaultJobStatus}
              />
            </SettingRow>

            <SettingRow
              label="Table density"
              description={`Server default: ${getOptionLabel(
                DENSITY_OPTIONS,
                defaultPreferences.density,
              )}`}
            >
              <Select
                ariaLabel="Table density"
                options={DENSITY_OPTIONS}
                value={preferences.density}
                onChange={setDensity}
              />
            </SettingRow>

            <SettingRow
              label="Timestamps"
              description={`Server default: ${getOptionLabel(
                TIMESTAMP_OPTIONS,
                defaultPreferences.timestamps,
              )}`}
            >
              <Select
                ariaLabel="Timestamps"
                options={TIMESTAMP_OPTIONS}
                value={preferences.timestamps}
                onChange={setTimestamps}
              />
            </SettingRow>

            <SettingRow
              label="Overview sparklines"
              description={`Server default: ${
                defaultPreferences.showOverviewMetrics ? "on" : "off"
              }`}
            >
              <Select
                ariaLabel="Overview sparklines"
                options={TOGGLE_OPTIONS}
                value={preferences.showOverviewMetrics ? "on" : "off"}
                onChange={(value) => setShowOverviewMetrics(value === "on")}
              />
            </SettingRow>

            <SettingRow
              label="Pinned queues"
              description="Pinned queues appear first in the sidebar and overview"
            >
              <span className="font-mono text-sm text-gray-600 dark:text-slate-300">
                {preferences.pinnedQueues.length}
              </span>
            </SettingRow>

            <SettingRow
              label="Reset local settings"
              description={`Preference scope: ${preferenceScope}`}
            >
              <Button
                onClick={resetPreferences}
                icon={<RotateCcw className="size-3.5" />}
                label="Reset"
              />
            </SettingRow>
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-slate-500">
            Server policy
          </h2>
          {server.isError ? (
            <div className="mt-2">
              <ErrorCard message="Could not fetch server settings" />
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-gray-100 px-4 dark:border-slate-800">
              <SettingRow
                label="Access default"
                description="Applied before matching queue-specific rules"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                  <Shield className="size-3" />
                  {server.data
                    ? ACCESS_MODE_LABELS[server.data.access.default]
                    : "Loading…"}
                </span>
              </SettingRow>

              <SettingRow
                label="Visible queue policies"
                description="Effective read-only and action-specific policies; hidden queues are omitted"
              >
                <span className="font-mono text-sm text-gray-600 dark:text-slate-300">
                  {server.data?.access.rules.length ?? "—"}
                </span>
              </SettingRow>

              {server.data?.access.rules.map((rule, index) => (
                <div
                  key={`${rule.queues.join(",")}-${index}`}
                  className="border-b border-gray-100 py-3 text-xs last:border-b-0 dark:border-slate-800"
                >
                  <div className="font-mono text-gray-700 dark:text-slate-300">
                    {rule.queues.join(", ")}
                  </div>
                  <div className="mt-1 text-gray-500 dark:text-slate-500">
                    {rule.mode ? ACCESS_MODE_LABELS[rule.mode] : "Inherit"}
                    {rule.deny.length > 0
                      ? ` · denies ${rule.deny.join(", ")}`
                      : ""}
                  </div>
                </div>
              ))}

              <SettingRow
                label="Sensitive-key redaction"
                description="Applied before API responses reach this browser"
              >
                {server.data ? (
                  <BooleanState
                    enabled={server.data.privacy.redactionEnabled}
                    falseLabel="Disabled"
                    trueLabel="Enabled"
                  />
                ) : (
                  <span className="text-sm text-gray-400 dark:text-slate-500">
                    Loading…
                  </span>
                )}
              </SettingRow>

              {server.data
                ? Object.entries(server.data.privacy.expose).map(
                    ([category, exposed]) => (
                      <SettingRow
                        key={category}
                        label={
                          PRIVACY_EXPOSURE_LABELS[
                            category as keyof typeof PRIVACY_EXPOSURE_LABELS
                          ] ?? category
                        }
                        description="Server-controlled data exposure"
                      >
                        <BooleanState enabled={exposed} />
                      </SettingRow>
                    ),
                  )
                : null}

              <SettingRow
                label="Search scan cap"
                description="Maximum jobs inspected by one filtered request or action"
              >
                <span className="font-mono text-sm text-gray-600 dark:text-slate-300">
                  {server.data?.search.maxScanned.toLocaleString() ?? "—"}
                </span>
              </SettingRow>

              <SettingRow
                label="Queue discovery"
                description={
                  !server.data
                    ? "Loading server policy…"
                    : server.data.discovery.enabled
                      ? `${server.data.discovery.type} · ${
                          server.data.discovery.discoveredCount
                        } discovered${
                          server.data.discovery.truncated ? " · truncated" : ""
                        }`
                      : "Static queues only"
                }
              >
                <span
                  className={`text-sm ${
                    !server.data
                      ? "text-gray-400 dark:text-slate-500"
                      : !server.data.discovery.enabled
                        ? "text-gray-500 dark:text-slate-400"
                        : server.data.discovery.healthy === false
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-700 dark:text-green-400"
                  }`}
                >
                  {!server.data
                    ? "Loading…"
                    : !server.data.discovery.enabled
                      ? "Disabled"
                      : server.data.discovery.healthy === false
                        ? "Stale"
                        : "Healthy"}
                </span>
              </SettingRow>

              {server.data?.discovery.lastSuccessfulRefreshAt ? (
                <SettingRow
                  label="Last discovery refresh"
                  description="Last successful Redis scan"
                >
                  <span className="text-sm text-gray-600 dark:text-slate-300">
                    <Timestamp
                      value={server.data.discovery.lastSuccessfulRefreshAt}
                      variant="full"
                    />
                  </span>
                </SettingRow>
              ) : null}

              <SettingRow
                label="Product"
                description="Configured by the Queuedash server"
              >
                <span className="text-sm text-gray-600 dark:text-slate-300">
                  {branding.name}
                  {branding.logoUrl ? " · custom logo" : ""}
                </span>
              </SettingRow>

              <SettingRow label="Version" description="Queuedash API package">
                <span className="font-mono text-sm text-gray-600 dark:text-slate-300">
                  {server.data?.version ?? "—"}
                </span>
              </SettingRow>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
};
