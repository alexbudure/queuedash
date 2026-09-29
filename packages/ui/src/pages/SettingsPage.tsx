import type {
  QueuedashDefaultJobStatus,
  QueuedashDensity,
  QueuedashTheme,
  QueuedashTimestampMode,
} from "@queuedash/api";
import { clsx } from "clsx";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Plus,
  RotateCcw,
  Shield,
  X,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { ErrorCard } from "../components/ErrorCard";
import { Layout } from "../components/Layout";
import { EDITOR_OPTIONS } from "../components/OpenInEditor";
import {
  type UserPreferences,
  useQueuedash,
} from "../components/QueuedashProvider";
import { Select, type SelectOption } from "../components/Select";
import { Skeleton } from "../components/Skeleton";
import { Timestamp } from "../components/Timestamp";
import {
  type CodeLinks,
  CUSTOM_URL_PLACEHOLDER,
  type EditorId,
  getFrameUrl,
  mapPath,
} from "../utils/codeLinks";
import { formatCount, formatCountLabel } from "../utils/format";
import {
  CARD,
  FOCUS_FIELD,
  FOCUS_RING,
  FOCUS_RING_DATA,
  INPUT_CLASS,
  SECTION_LABEL,
  TEXT_MUTED,
} from "../utils/styles";
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

const ROW_CLASS =
  "flex flex-col gap-3 border-b border-gray-100 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-6 dark:border-slate-800";

/** A label 400px from the control it names reads as two unrelated things, so
 *  the text column is capped rather than stretched to the card's full width. */
const ROW_TEXT_CLASS = "min-w-0 flex-1 sm:max-w-md";

/** Every row's control lands in the same 176px slot on the card's right edge,
 *  so the right-hand column reads as one column rather than five. */
const CONTROL_SLOT_CLASS =
  "flex min-h-9 w-full shrink-0 items-center sm:ml-auto sm:w-44 sm:justify-end";

const FACT_TONE_CLASS = {
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-gray-600 dark:text-slate-300",
  positive: "text-green-700 dark:text-green-400",
  muted: TEXT_MUTED,
} as const;

const SettingRow = ({
  description,
  label,
  children,
}: {
  description: ReactNode;
  label: string;
  children: ReactNode;
}) => (
  <div className={ROW_CLASS}>
    <div className={ROW_TEXT_CLASS}>
      <div className="text-sm font-medium text-gray-900 dark:text-white">
        {label}
      </div>
      <div className={clsx("mt-0.5 text-xs", TEXT_MUTED)}>{description}</div>
    </div>
    <div className={CONTROL_SLOT_CLASS}>{children}</div>
  </div>
);

const SettingRowSkeleton = () => (
  <div className={ROW_CLASS}>
    <div className={ROW_TEXT_CLASS}>
      <Skeleton className="h-4 w-32 rounded" />
      <Skeleton className="mt-1.5 h-3 w-52 rounded" />
    </div>
    <div className={CONTROL_SLOT_CLASS}>
      <Skeleton className="h-5 w-20 rounded" />
    </div>
  </div>
);

/**
 * The one presentation for a read-only fact: plain text, never a chip or a
 * bordered box, so nothing in the Server policy column can be mistaken for a
 * control the reader is allowed to change.
 */
const FactValue = ({
  children,
  icon,
  isMono = false,
  tone = "neutral",
}: {
  children: ReactNode;
  icon?: ReactNode;
  isMono?: boolean;
  tone?: keyof typeof FACT_TONE_CLASS;
}) => (
  <span
    className={clsx(
      "inline-flex items-center gap-1.5 text-sm",
      isMono && "font-mono",
      FACT_TONE_CLASS[tone],
    )}
  >
    {icon}
    {children}
  </span>
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
  <FactValue
    tone={enabled ? "positive" : "muted"}
    icon={
      enabled ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <X aria-hidden="true" className="size-3.5" />
      )
    }
  >
    {enabled ? trueLabel : falseLabel}
  </FactValue>
);

/**
 * A binary is one bit. Spending a combobox, a portal and a two-item listbox on
 * it made "on or off" look like an open-ended choice.
 */
const SegmentedControl = <T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
}) => (
  <ToggleButtonGroup
    aria-label={ariaLabel}
    selectionMode="single"
    disallowEmptySelection
    selectedKeys={new Set([value])}
    onSelectionChange={(keys) => {
      const selected = keys.values().next().value;
      if (selected) onChange(String(selected) as T);
    }}
    className="flex h-8 w-full items-center rounded-lg bg-gray-100 p-0.5 dark:bg-slate-800"
  >
    {options.map((option) => (
      <ToggleButton
        key={option.value}
        id={option.value}
        className={clsx(
          "h-full flex-1 rounded-md text-sm font-medium transition-colors duration-150",
          TEXT_MUTED,
          FOCUS_RING_DATA,
          "hover:text-gray-900 dark:hover:text-white",
          "data-[pressed]:bg-gray-200 dark:data-[pressed]:bg-slate-700",
          "data-[selected]:bg-white data-[selected]:text-gray-900 data-[selected]:shadow-sm dark:data-[selected]:bg-slate-700 dark:data-[selected]:text-white dark:data-[selected]:shadow-none",
        )}
      >
        {option.label}
      </ToggleButton>
    ))}
  </ToggleButtonGroup>
);

/**
 * A "My dashboard" row. The description answers the question the page exists
 * for - what have I changed on this machine - by naming the override and
 * offering the way back, and explaining the setting when nothing is overridden.
 */
const PreferenceRow = ({
  children,
  defaultLabel,
  hint,
  isOverridden,
  label,
  onReset,
  resetLabel = "Reset",
}: {
  children: ReactNode;
  defaultLabel: string;
  hint: string;
  isOverridden: boolean;
  label: string;
  onReset: () => void;
  resetLabel?: string;
}) => (
  <SettingRow
    label={label}
    description={
      isOverridden ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            Overridden
          </span>
          <span>Server default: {defaultLabel}</span>
          <button
            type="button"
            onClick={onReset}
            // Seven rows carry this control, so the accessible name has to say
            // which one it belongs to.
            aria-label={`${resetLabel} ${label.toLowerCase()}`}
            className={clsx(
              "rounded font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline active:text-brand-900 dark:text-brand-300 dark:hover:text-brand-200 dark:active:text-brand-100",
              FOCUS_RING,
            )}
          >
            {resetLabel}
          </button>
        </span>
      ) : (
        hint
      )
    }
  >
    {children}
  </SettingRow>
);

type EditorChoice = EditorId | "off" | "unset";

const EDITOR_CHOICES: Array<SelectOption<EditorChoice>> = [
  { label: "Not set", value: "unset" },
  ...EDITOR_OPTIONS,
  { label: "Off", value: "off" },
];

/** A row whose control needs the card's width: a list, a URL, a preview. */
const STACKED_ROW_CLASS =
  "border-b border-gray-100 py-4 last:border-b-0 dark:border-slate-800";

const PATH_INPUT = clsx(INPUT_CLASS, FOCUS_FIELD, "font-mono text-[13px]");

const trimSlash = (path: string) => path.trim().replace(/\/+$/, "");

/** `text` with the first `part` in it marked, for the preview's mapped folder. */
const MarkedPart = ({ text, part }: { text: string; part: string }) => {
  const index = part ? text.indexOf(part) : -1;
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className="rounded-sm bg-brand-50 px-0.5 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
        {part}
      </span>
      {text.slice(index + part.length)}
    </>
  );
};

/**
 * Where stack frames open. Per browser, like everything under My dashboard,
 * because everyone's checkout lives somewhere else; the job panel sets it up
 * the first time a frame is opened, so this is mostly for changing it.
 */
const CodeLinksSettings = ({
  codeLinks,
  onChange,
}: {
  codeLinks: CodeLinks;
  onChange: (codeLinks: CodeLinks) => void;
}) => {
  const customUrlId = useId();
  const choice: EditorChoice = codeLinks.editor ?? "unset";
  const isOn = codeLinks.editor !== null && codeLinks.editor !== "off";
  const firstFrom = trimSlash(codeLinks.mappings[0]?.from ?? "");
  const examplePath =
    codeLinks.examplePath ?? `${firstFrom || "/app"}/src/index.ts`;
  const exampleUrl = getFrameUrl(codeLinks, {
    fn: null,
    path: examplePath,
    line: 1,
    column: 1,
    isLibrary: false,
    pkg: null,
    label: "",
  });
  const mappedPath = mapPath(examplePath, codeLinks.mappings);
  const mapping = codeLinks.mappings.find(
    ({ from, to }) =>
      trimSlash(from) &&
      trimSlash(to) &&
      mappedPath.startsWith(trimSlash(to)) &&
      examplePath.startsWith(trimSlash(from)),
  );
  const mappedTo = mapping ? trimSlash(mapping.to) : "";
  const urlPart = exampleUrl
    ? ([encodeURI(mappedTo), encodeURIComponent(mappedTo)].find(
        (part) => part && exampleUrl.includes(part),
      ) ?? "")
    : "";

  const setMappings = (mappings: CodeLinks["mappings"]) =>
    onChange({ ...codeLinks, mappings });

  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={SECTION_LABEL}>Code links</h2>
        <p className={clsx("text-xs", TEXT_MUTED)}>Saved in this browser</p>
      </div>
      <div className={clsx(CARD, "mt-2 px-4")}>
        <SettingRow
          label="Editor"
          description={
            codeLinks.editor === null
              ? "The job panel asks the first time you open a stack frame"
              : codeLinks.editor === "off"
                ? "Stack frames show no editor links"
                : "Stack frames in the job panel open at the failing line"
          }
        >
          <Select
            ariaLabel="Editor"
            options={EDITOR_CHOICES}
            value={choice}
            onChange={(next) =>
              onChange({
                ...codeLinks,
                editor: next === "unset" ? null : next,
              })
            }
          />
        </SettingRow>

        {codeLinks.editor === "custom" ? (
          <div className={STACKED_ROW_CLASS}>
            <label
              htmlFor={customUrlId}
              className="text-sm font-medium text-gray-900 dark:text-white"
            >
              Editor URL
            </label>
            <p className={clsx("mt-0.5 text-xs", TEXT_MUTED)}>
              {"{path}"}, {"{line}"} and {"{column}"} are filled in from the
              frame
            </p>
            <input
              id={customUrlId}
              value={codeLinks.customUrl}
              onChange={(event) =>
                onChange({ ...codeLinks, customUrl: event.target.value })
              }
              placeholder={CUSTOM_URL_PLACEHOLDER}
              spellCheck={false}
              className={clsx(PATH_INPUT, "mt-3 text-xs")}
            />
          </div>
        ) : null}

        <div className={STACKED_ROW_CLASS}>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            Path mapping
          </div>
          <div className={clsx("mt-0.5 max-w-md text-xs", TEXT_MUTED)}>
            Workers report paths from where they run. Map each one to the same
            folder on this machine.
          </div>
          {codeLinks.mappings.length > 0 ? (
            <div className="mt-3 space-y-2">
              {codeLinks.mappings.map((pathMapping, index) => (
                <div
                  // Rows are only appended or removed, never reordered.
                  key={index}
                  className="grid grid-cols-[minmax(0,12.5rem)_14px_minmax(0,1fr)_28px] items-center gap-x-2.5"
                >
                  <input
                    aria-label={`Path on the workers, mapping ${index + 1}`}
                    value={pathMapping.from}
                    onChange={(event) =>
                      setMappings(
                        codeLinks.mappings.map((current, at) =>
                          at === index
                            ? { ...current, from: event.target.value }
                            : current,
                        ),
                      )
                    }
                    placeholder="/app"
                    spellCheck={false}
                    className={PATH_INPUT}
                  />
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 text-gray-400 dark:text-slate-500"
                  />
                  <input
                    aria-label={`Path on this machine, mapping ${index + 1}`}
                    value={pathMapping.to}
                    onChange={(event) =>
                      setMappings(
                        codeLinks.mappings.map((current, at) =>
                          at === index
                            ? { ...current, to: event.target.value }
                            : current,
                        ),
                      )
                    }
                    placeholder="/Users/you/code/app"
                    spellCheck={false}
                    className={PATH_INPUT}
                  />
                  <button
                    type="button"
                    aria-label={`Remove mapping ${index + 1}`}
                    onClick={() =>
                      setMappings(
                        codeLinks.mappings.filter((_, at) => at !== index),
                      )
                    }
                    className={clsx(
                      "flex size-7 items-center justify-center rounded-md transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200 dark:hover:bg-slate-800 dark:hover:text-white dark:active:bg-slate-700",
                      TEXT_MUTED,
                      FOCUS_RING,
                    )}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() =>
              setMappings([...codeLinks.mappings, { from: "", to: "" }])
            }
            className={clsx(
              "mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 active:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200",
              FOCUS_RING,
            )}
          >
            <Plus aria-hidden="true" className="size-3" />
            Add mapping
          </button>
        </div>

        {isOn ? (
          <div className={STACKED_ROW_CLASS}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Preview
              </div>
              <span className={clsx("text-xs", TEXT_MUTED)}>
                {codeLinks.examplePath
                  ? "The last frame you set this up from"
                  : "An example path"}
              </span>
            </div>
            <div className="mt-2.5 rounded-lg border border-gray-100/80 bg-gray-50/50 px-3 py-2.5 font-mono text-xs leading-5 dark:border-slate-800/60 dark:bg-slate-900/50">
              <div className={clsx("break-all", TEXT_MUTED)}>
                <MarkedPart
                  text={`${examplePath}:1:1`}
                  part={mapping ? trimSlash(mapping.from) : ""}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="min-w-0 break-all text-gray-900 dark:text-white">
                  {exampleUrl ? (
                    <MarkedPart text={exampleUrl} part={urlPart} />
                  ) : (
                    "Add the editor's URL above"
                  )}
                </span>
                {exampleUrl ? (
                  <a
                    href={exampleUrl}
                    className={clsx(
                      "inline-flex shrink-0 items-center gap-1 rounded font-sans text-xs font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200",
                      FOCUS_RING,
                    )}
                  >
                    Try it
                    <ArrowUpRight aria-hidden="true" className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <p className={clsx("mt-2 text-xs", TEXT_MUTED)}>
        Frames point at compiled <span className="font-mono">dist/*.js</span>?
        Start your workers with{" "}
        <span className="font-mono">node --enable-source-maps</span> and
        they&apos;ll point at your source.
      </p>
    </section>
  );
};

export const SettingsPage = () => {
  const {
    branding,
    codeLinks,
    defaultPreferences,
    overrides,
    preferenceScope,
    preferences,
    resetPreferences,
    setCodeLinks,
    setDefaultJobStatus,
    setDensity,
    setJobsPerPage,
    setRefreshInterval,
    setShowOverviewMetrics,
    setTheme,
    setTimestamps,
    togglePinnedQueue,
  } = useQueuedash();
  const server = trpc.settings.get.useQuery();
  const pinnedCount = preferences.pinnedQueues.length;
  // The question this page exists to answer, answered once at the top rather
  // than by scanning eight rows for the ones that differ. It counts what this
  // browser chose, not values that happen to differ: a setting left alone
  // keeps following the server default.
  const overrideCount = [
    overrides.theme !== undefined,
    overrides.refreshIntervalMs !== undefined,
    overrides.jobsPerPage !== undefined,
    overrides.defaultJobStatus !== undefined,
    overrides.density !== undefined,
    overrides.timestamps !== undefined,
    overrides.showOverviewMetrics !== undefined,
    pinnedCount > 0,
  ].filter(Boolean).length;
  // The pins are the only reset casualty a user cannot rebuild from this page,
  // so both the row and the confirmation name how many are at stake.
  const pinnedNote =
    pinnedCount > 0
      ? `, and unpins ${formatCountLabel(pinnedCount, "queue")}`
      : "";
  const hasCodeLinks =
    codeLinks.editor !== null || codeLinks.mappings.length > 0;
  const codeLinksNote = hasCodeLinks ? ", and forgets your code links" : "";

  return (
    <Layout>
      <div className="max-w-3xl">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h1>
          <p className={clsx("mt-1 text-sm", TEXT_MUTED)}>
            Dashboard overrides stay in this browser. Server policy is read-only
            here and cannot be bypassed by local settings.
          </p>
        </div>

        <section className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={SECTION_LABEL}>My dashboard</h2>
            <p className={clsx("text-xs", TEXT_MUTED)}>
              {overrideCount === 0
                ? "Nothing overridden on this machine"
                : `${formatCountLabel(overrideCount, "setting")} overridden on this machine`}
            </p>
          </div>
          <div className={clsx(CARD, "mt-2 px-4")}>
            <PreferenceRow
              label="Appearance"
              hint="Light, dark, or whatever this device is set to"
              defaultLabel={getOptionLabel(
                THEME_OPTIONS,
                defaultPreferences.theme,
              )}
              isOverridden={overrides.theme !== undefined}
              onReset={() => setTheme(defaultPreferences.theme)}
            >
              <Select
                ariaLabel="Appearance"
                options={THEME_OPTIONS}
                value={preferences.theme}
                onChange={setTheme}
              />
            </PreferenceRow>

            <PreferenceRow
              label="Auto-refresh"
              hint="How often open tables and counts re-fetch"
              defaultLabel={formatRefreshIntervalLabel(
                defaultPreferences.refreshIntervalMs,
              )}
              isOverridden={overrides.refreshIntervalMs !== undefined}
              onReset={() =>
                setRefreshInterval(defaultPreferences.refreshIntervalMs)
              }
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
            </PreferenceRow>

            <PreferenceRow
              label="Jobs per load"
              hint="Rows fetched each time a job table loads more"
              defaultLabel={String(defaultPreferences.jobsPerPage)}
              isOverridden={overrides.jobsPerPage !== undefined}
              onReset={() => setJobsPerPage(defaultPreferences.jobsPerPage)}
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
            </PreferenceRow>

            <PreferenceRow
              label="Default job tab"
              hint="The status a queue opens on"
              defaultLabel={getOptionLabel(
                JOB_STATUS_OPTIONS,
                defaultPreferences.defaultJobStatus,
              )}
              isOverridden={overrides.defaultJobStatus !== undefined}
              onReset={() =>
                setDefaultJobStatus(defaultPreferences.defaultJobStatus)
              }
            >
              <Select
                ariaLabel="Default job tab"
                options={JOB_STATUS_OPTIONS}
                value={preferences.defaultJobStatus}
                onChange={setDefaultJobStatus}
              />
            </PreferenceRow>

            <PreferenceRow
              label="Table density"
              hint="Row height in the job and scheduler tables"
              defaultLabel={getOptionLabel(
                DENSITY_OPTIONS,
                defaultPreferences.density,
              )}
              isOverridden={overrides.density !== undefined}
              onReset={() => setDensity(defaultPreferences.density)}
            >
              <Select
                ariaLabel="Table density"
                options={DENSITY_OPTIONS}
                value={preferences.density}
                onChange={setDensity}
              />
            </PreferenceRow>

            <PreferenceRow
              label="Timestamps"
              hint="Whether times read as an exact date or as time ago"
              defaultLabel={getOptionLabel(
                TIMESTAMP_OPTIONS,
                defaultPreferences.timestamps,
              )}
              isOverridden={overrides.timestamps !== undefined}
              onReset={() => setTimestamps(defaultPreferences.timestamps)}
            >
              <Select
                ariaLabel="Timestamps"
                options={TIMESTAMP_OPTIONS}
                value={preferences.timestamps}
                onChange={setTimestamps}
              />
            </PreferenceRow>

            <PreferenceRow
              label="Overview sparklines"
              hint="Draws each overview card's recent throughput"
              defaultLabel={getOptionLabel(
                TOGGLE_OPTIONS,
                defaultPreferences.showOverviewMetrics ? "on" : "off",
              )}
              isOverridden={overrides.showOverviewMetrics !== undefined}
              onReset={() =>
                setShowOverviewMetrics(defaultPreferences.showOverviewMetrics)
              }
            >
              <SegmentedControl
                ariaLabel="Overview sparklines"
                options={TOGGLE_OPTIONS}
                value={preferences.showOverviewMetrics ? "on" : "off"}
                onChange={(value) => setShowOverviewMetrics(value === "on")}
              />
            </PreferenceRow>

            <PreferenceRow
              label="Pinned queues"
              hint="Pinned queues appear first in the sidebar and overview"
              defaultLabel="none"
              isOverridden={pinnedCount > 0}
              resetLabel="Unpin all"
              // Each toggle folds into the previous one's state, so unpinning
              // the list one name at a time still lands on an empty list.
              onReset={() =>
                preferences.pinnedQueues.forEach(togglePinnedQueue)
              }
            >
              <FactValue isMono>{formatCount(pinnedCount)}</FactValue>
            </PreferenceRow>
          </div>
        </section>

        <CodeLinksSettings codeLinks={codeLinks} onChange={setCodeLinks} />

        <section className="mt-7">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={SECTION_LABEL}>Server policy</h2>
            <span className="rounded-full bg-gray-100 px-2 py-px text-[10px] font-medium text-gray-600 dark:bg-slate-800 dark:text-slate-300">
              Read-only
            </span>
          </div>
          {server.isError ? (
            <div className="mt-2">
              <ErrorCard
                title="Could not fetch server settings"
                message="Server policy could not be read. Your local preferences above still apply."
                onRetry={() => server.refetch()}
                isRetrying={server.isRefetching}
              />
            </div>
          ) : (
            <div className={clsx(CARD, "mt-2 px-4")}>
              <SettingRow
                label="Access default"
                description="Applied before matching queue-specific rules"
              >
                {server.data ? (
                  <FactValue
                    icon={<Shield aria-hidden="true" className="size-3.5" />}
                  >
                    {ACCESS_MODE_LABELS[server.data.access.default]}
                  </FactValue>
                ) : (
                  <Skeleton className="h-5 w-24 rounded" />
                )}
              </SettingRow>

              <SettingRow
                label="Visible queue policies"
                description="Effective read-only and action-specific policies; hidden queues are omitted"
              >
                {server.data ? (
                  <FactValue isMono>
                    {formatCount(server.data.access.rules.length)}
                  </FactValue>
                ) : (
                  <Skeleton className="h-5 w-8 rounded" />
                )}
              </SettingRow>

              {server.data
                ? server.data.access.rules.map((rule, index) => (
                    <div
                      key={`${rule.queues.join(",")}-${index}`}
                      className="border-b border-gray-100 py-3 text-xs last:border-b-0 dark:border-slate-800"
                    >
                      <div className="font-mono text-gray-700 dark:text-slate-300">
                        {rule.queues.join(", ")}
                      </div>
                      <div className={clsx("mt-1", TEXT_MUTED)}>
                        {rule.mode ? ACCESS_MODE_LABELS[rule.mode] : "Inherit"}
                        {rule.deny.length > 0
                          ? ` · denies ${rule.deny.join(", ")}`
                          : ""}
                      </div>
                    </div>
                  ))
                : [...Array(2)].map((_, index) => (
                    <div
                      key={index}
                      className="border-b border-gray-100 py-3 last:border-b-0 dark:border-slate-800"
                    >
                      <Skeleton className="h-3.5 w-40 rounded" />
                      <Skeleton className="mt-1.5 h-3 w-28 rounded" />
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
                  <Skeleton className="h-5 w-20 rounded" />
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
                : [...Array(3)].map((_, index) => (
                    <SettingRowSkeleton key={index} />
                  ))}

              <SettingRow
                label="Search scan cap"
                description="Maximum jobs inspected by one filtered request or action"
              >
                {server.data ? (
                  <FactValue isMono>
                    {formatCount(server.data.search.maxScanned)}
                  </FactValue>
                ) : (
                  <Skeleton className="h-5 w-16 rounded" />
                )}
              </SettingRow>

              <SettingRow
                label="Queue discovery"
                description={
                  !server.data ? (
                    <Skeleton className="h-3 w-44 rounded" />
                  ) : server.data.discovery.enabled ? (
                    `${server.data.discovery.type} · ${
                      server.data.discovery.discoveredCount
                    } discovered${
                      server.data.discovery.truncated ? " · truncated" : ""
                    }`
                  ) : (
                    "Static queues only"
                  )
                }
              >
                {!server.data ? (
                  <Skeleton className="h-5 w-16 rounded" />
                ) : (
                  <FactValue
                    tone={
                      !server.data.discovery.enabled
                        ? "muted"
                        : server.data.discovery.healthy === false
                          ? "negative"
                          : "positive"
                    }
                  >
                    {!server.data.discovery.enabled
                      ? "Disabled"
                      : server.data.discovery.healthy === false
                        ? "Stale"
                        : "Healthy"}
                  </FactValue>
                )}
              </SettingRow>

              {server.data?.discovery.lastSuccessfulRefreshAt ? (
                <SettingRow
                  label="Last discovery refresh"
                  description="Last successful Redis scan"
                >
                  <FactValue>
                    <Timestamp
                      value={server.data.discovery.lastSuccessfulRefreshAt}
                      variant="full"
                    />
                  </FactValue>
                </SettingRow>
              ) : null}

              <SettingRow
                label="Product"
                description="Configured by the Queuedash server"
              >
                <FactValue>
                  {branding.name}
                  {branding.logoUrl ? " · custom logo" : ""}
                </FactValue>
              </SettingRow>

              <SettingRow label="Version" description="Queuedash API package">
                {server.data ? (
                  <FactValue isMono>{server.data.version}</FactValue>
                ) : (
                  <Skeleton className="h-5 w-12 rounded" />
                )}
              </SettingRow>
            </div>
          )}
        </section>

        <section className="mt-7">
          <h2 className={SECTION_LABEL}>Danger zone</h2>
          <div className="mt-2 rounded-xl border border-red-200/70 px-4 dark:border-red-900/60">
            <SettingRow
              label="Reset local settings"
              description={`Restores appearance, auto-refresh, jobs per load, default tab, density and timestamps to the server defaults${pinnedNote}${codeLinksNote}. Preference scope: ${preferenceScope}`}
            >
              <Alert
                title="Reset local settings?"
                description={`Every dashboard preference in this browser goes back to the server default${pinnedNote}${codeLinksNote}. This cannot be undone.`}
                action={
                  <Button
                    variant="filled"
                    colorScheme="red"
                    label="Reset settings"
                    onClick={resetPreferences}
                  />
                }
              >
                <Button
                  as="span"
                  colorScheme="red"
                  icon={<RotateCcw className="size-3.5" />}
                  label="Reset"
                />
              </Alert>
            </SettingRow>
          </div>
        </section>
      </div>
    </Layout>
  );
};
