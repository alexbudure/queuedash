import type {
  QueuedashDefaultJobStatus,
  QueuedashDensity,
  QueuedashTheme,
  QueuedashTimestampMode,
} from "@queuedash/api";
import { Check, RotateCcw, Shield, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../components/Button";
import { Layout } from "../components/Layout";
import {
  type UserPreferences,
  useQueuedash,
} from "../components/QueuedashProvider";
import { Timestamp } from "../components/Timestamp";
import { trpc } from "../utils/trpc";

const THEME_OPTIONS: Array<{ label: string; value: QueuedashTheme }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const REFRESH_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "1 second", value: "1000" },
  { label: "2 seconds", value: "2000" },
  { label: "5 seconds", value: "5000" },
  { label: "10 seconds", value: "10000" },
  { label: "30 seconds", value: "30000" },
  { label: "1 minute", value: "60000" },
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

const selectClassName =
  "min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

const formatRefreshInterval = (value: number | false): string =>
  value === false ? "off" : `${value / 1_000}s`;

const SettingRow = ({
  description,
  label,
  children,
}: {
  description: string;
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col justify-between gap-3 border-b border-gray-100 py-4 last:border-b-0 dark:border-slate-800 sm:flex-row sm:items-center">
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
            My dashboard
          </h2>
          <div className="mt-2 rounded-xl border border-gray-100 px-4 dark:border-slate-800">
            <SettingRow
              label="Appearance"
              description={`Server default: ${defaultPreferences.theme}`}
            >
              <select
                aria-label="Appearance"
                value={preferences.theme}
                onChange={(event) =>
                  setTheme(event.target.value as QueuedashTheme)
                }
                className={selectClassName}
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Auto-refresh"
              description={`Server default: ${formatRefreshInterval(
                defaultPreferences.refreshIntervalMs,
              )}`}
            >
              <select
                aria-label="Auto-refresh"
                value={
                  preferences.refreshIntervalMs === false
                    ? "off"
                    : String(preferences.refreshIntervalMs)
                }
                onChange={(event) =>
                  setRefreshInterval(
                    event.target.value === "off"
                      ? false
                      : Number(event.target.value),
                  )
                }
                className={selectClassName}
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Jobs per load"
              description={`Server default: ${defaultPreferences.jobsPerPage}`}
            >
              <select
                aria-label="Jobs per load"
                value={preferences.jobsPerPage}
                onChange={(event) =>
                  setJobsPerPage(
                    Number(
                      event.target.value,
                    ) as UserPreferences["jobsPerPage"],
                  )
                }
                className={selectClassName}
              >
                {[20, 30, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Default job tab"
              description={`Server default: ${defaultPreferences.defaultJobStatus}`}
            >
              <select
                aria-label="Default job tab"
                value={preferences.defaultJobStatus}
                onChange={(event) =>
                  setDefaultJobStatus(
                    event.target.value as QueuedashDefaultJobStatus,
                  )
                }
                className={selectClassName}
              >
                {JOB_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Table density"
              description={`Server default: ${defaultPreferences.density}`}
            >
              <select
                aria-label="Table density"
                value={preferences.density}
                onChange={(event) =>
                  setDensity(event.target.value as QueuedashDensity)
                }
                className={selectClassName}
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Timestamps"
              description={`Server default: ${defaultPreferences.timestamps}`}
            >
              <select
                aria-label="Timestamps"
                value={preferences.timestamps}
                onChange={(event) =>
                  setTimestamps(event.target.value as QueuedashTimestampMode)
                }
                className={selectClassName}
              >
                <option value="relative">Relative</option>
                <option value="absolute">Absolute</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Overview sparklines"
              description={`Server default: ${
                defaultPreferences.showOverviewMetrics ? "on" : "off"
              }`}
            >
              <select
                aria-label="Overview sparklines"
                value={preferences.showOverviewMetrics ? "on" : "off"}
                onChange={(event) =>
                  setShowOverviewMetrics(event.target.value === "on")
                }
                className={selectClassName}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
            Server policy
          </h2>
          <div className="mt-2 rounded-xl border border-gray-100 px-4 dark:border-slate-800">
            <SettingRow
              label="Access default"
              description="Applied before matching queue-specific rules"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                <Shield className="size-3" />
                {server.data?.access.default ?? "Loading…"}
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
                  {rule.mode ?? "inherit"}
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
              <BooleanState
                enabled={server.data?.privacy.redactionEnabled === true}
                falseLabel="Disabled"
                trueLabel="Enabled"
              />
            </SettingRow>

            {server.data
              ? Object.entries(server.data.privacy.expose).map(
                  ([category, exposed]) => (
                    <SettingRow
                      key={category}
                      label={category.replaceAll(/([A-Z])/g, " $1")}
                      description="Server-controlled data exposure"
                    >
                      <BooleanState enabled={exposed} />
                    </SettingRow>
                  ),
                )
              : null}

            <SettingRow
              label="Search scan cap"
              description="Maximum jobs inspected by one search request"
            >
              <span className="font-mono text-sm text-gray-600 dark:text-slate-300">
                {server.data?.search.maxScanned.toLocaleString() ?? "—"}
              </span>
            </SettingRow>

            <SettingRow
              label="Queue discovery"
              description={
                server.data?.discovery.enabled
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
                  server.data?.discovery.healthy === false
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-700 dark:text-green-400"
                }`}
              >
                {server.data?.discovery.healthy === false ? "Stale" : "Healthy"}
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
        </section>
      </div>
    </Layout>
  );
};
