import type {
  QueuedashDefaultJobStatus,
  QueuedashDensity,
  QueuedashTheme,
  QueuedashTimestampMode,
  QueuedashUiConfig,
} from "@queuedash/api";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type CodeLinks,
  EMPTY_CODE_LINKS,
  parseCodeLinks,
} from "../utils/codeLinks";

export type UserPreferences = {
  defaultJobStatus: QueuedashDefaultJobStatus;
  density: QueuedashDensity;
  jobsPerPage: 20 | 30 | 50 | 100;
  lastJobStatus: Exclude<QueuedashDefaultJobStatus, "remember">;
  pinnedQueues: string[];
  refreshIntervalMs: number | false;
  showOverviewMetrics: boolean;
  theme: QueuedashTheme;
  timestamps: QueuedashTimestampMode;
};

/** The preferences a server defaults through `ui.defaults`. */
type PreferenceSetting = Exclude<
  keyof UserPreferences,
  "lastJobStatus" | "pinnedQueues"
>;

type PreferenceOverrides = Partial<Pick<UserPreferences, PreferenceSetting>>;

/** What this browser keeps: the settings it explicitly changed, and the state
 *  that has no server default at all. */
type StoredPreferences = {
  overrides: PreferenceOverrides;
  lastJobStatus: UserPreferences["lastJobStatus"];
  pinnedQueues: string[];
  codeLinks: CodeLinks;
};

type ResolvedBranding = {
  name: string;
  logoUrl?: string;
  logoAlt: string;
};

type QueuedashContextValue = {
  branding: ResolvedBranding;
  codeLinks: CodeLinks;
  defaultPreferences: UserPreferences;
  documentTitle: boolean;
  isDark: boolean;
  overrides: PreferenceOverrides;
  portalContainer: Element | null;
  preferences: UserPreferences;
  preferenceScope: string;
  resetPreferences: () => void;
  setCodeLinks: (codeLinks: CodeLinks) => void;
  setDefaultJobStatus: (status: QueuedashDefaultJobStatus) => void;
  setDensity: (density: QueuedashDensity) => void;
  setJobsPerPage: (jobsPerPage: UserPreferences["jobsPerPage"]) => void;
  setLastJobStatus: (status: UserPreferences["lastJobStatus"]) => void;
  setPortalContainer: (element: Element | null) => void;
  setRefreshInterval: (refreshIntervalMs: number | false) => void;
  setShowOverviewMetrics: (showOverviewMetrics: boolean) => void;
  setTheme: (theme: QueuedashTheme) => void;
  setTimestamps: (timestamps: QueuedashTimestampMode) => void;
  togglePinnedQueue: (queueName: string) => void;
};

const DEFAULT_PRODUCT_NAME = "Queuedash";
const DEFAULT_REFRESH_INTERVAL_MS = 2_000;
const MIN_REFRESH_INTERVAL_MS = 1_000;
const MAX_REFRESH_INTERVAL_MS = 60_000;
const LEGACY_STORAGE_KEY = "user-preferences";
const STORAGE_VERSION = 2;
const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const QueuedashContext = createContext<QueuedashContextValue | null>(null);

const isTheme = (value: unknown): value is QueuedashTheme =>
  value === "light" || value === "dark" || value === "system";

const JOBS_PER_PAGE_OPTIONS = [20, 30, 50, 100] as const;
const JOB_STATUSES = [
  "completed",
  "failed",
  "delayed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "paused",
] as const;

const isDefaultJobStatus = (
  value: unknown,
): value is QueuedashDefaultJobStatus =>
  value === "remember" ||
  JOB_STATUSES.includes(value as (typeof JOB_STATUSES)[number]);

const isJobStatus = (
  value: unknown,
): value is UserPreferences["lastJobStatus"] =>
  JOB_STATUSES.includes(value as (typeof JOB_STATUSES)[number]);

const clampRefreshInterval = (value: number | false): number | false =>
  value === false
    ? false
    : Math.min(
        Math.max(Math.round(value), MIN_REFRESH_INTERVAL_MS),
        MAX_REFRESH_INTERVAL_MS,
      );

const EMPTY_STORED_PREFERENCES: StoredPreferences = {
  overrides: {},
  lastJobStatus: "completed",
  pinnedQueues: [],
  codeLinks: EMPTY_CODE_LINKS,
};

const readStorageItem = (key: string): unknown => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

const writeStoredPreferences = (key: string, stored: StoredPreferences) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ v: STORAGE_VERSION, ...stored }),
    );
  } catch {
    // Browser storage is an optional enhancement.
  }
};

const parseOverrides = (value: unknown): PreferenceOverrides => {
  const parsed = value as {
    defaultJobStatus?: unknown;
    density?: unknown;
    jobsPerPage?: unknown;
    refreshIntervalMs?: unknown;
    showOverviewMetrics?: unknown;
    theme?: unknown;
    timestamps?: unknown;
  };
  return {
    ...(isDefaultJobStatus(parsed?.defaultJobStatus)
      ? { defaultJobStatus: parsed.defaultJobStatus }
      : {}),
    ...(parsed?.density === "compact" || parsed?.density === "comfortable"
      ? { density: parsed.density }
      : {}),
    ...(JOBS_PER_PAGE_OPTIONS.includes(
      parsed?.jobsPerPage as (typeof JOBS_PER_PAGE_OPTIONS)[number],
    )
      ? {
          jobsPerPage: parsed.jobsPerPage as UserPreferences["jobsPerPage"],
        }
      : {}),
    ...(isTheme(parsed?.theme) ? { theme: parsed.theme } : {}),
    ...((typeof parsed?.refreshIntervalMs === "number" &&
      Number.isFinite(parsed.refreshIntervalMs)) ||
    parsed?.refreshIntervalMs === false
      ? {
          refreshIntervalMs: clampRefreshInterval(parsed.refreshIntervalMs),
        }
      : {}),
    ...(typeof parsed?.showOverviewMetrics === "boolean"
      ? { showOverviewMetrics: parsed.showOverviewMetrics }
      : {}),
    ...(parsed?.timestamps === "relative" || parsed?.timestamps === "absolute"
      ? { timestamps: parsed.timestamps }
      : {}),
  };
};

const parseUserState = (
  value: unknown,
): Partial<Omit<StoredPreferences, "overrides">> => {
  const parsed = value as {
    codeLinks?: unknown;
    lastJobStatus?: unknown;
    pinnedQueues?: unknown;
  };
  return {
    ...(parsed?.codeLinks !== undefined
      ? { codeLinks: parseCodeLinks(parsed.codeLinks) }
      : {}),
    ...(isJobStatus(parsed?.lastJobStatus)
      ? { lastJobStatus: parsed.lastJobStatus }
      : {}),
    ...(Array.isArray(parsed?.pinnedQueues)
      ? {
          pinnedQueues: parsed.pinnedQueues.filter(
            (queueName): queueName is string => typeof queueName === "string",
          ),
        }
      : {}),
  };
};

/**
 * Choosing the server default is not an override. Storing it would pin this
 * browser to today's default, so a later change on the server - a slower poll
 * for everyone, say - would never reach it.
 */
const withOverride = <Key extends PreferenceSetting>(
  overrides: PreferenceOverrides,
  key: Key,
  value: UserPreferences[Key] | undefined,
  defaults: UserPreferences,
): PreferenceOverrides => {
  const next = { ...overrides };
  if (value === undefined || value === defaults[key]) delete next[key];
  else next[key] = value;
  return next;
};

const isCurrentVersion = (value: unknown): value is { overrides?: unknown } =>
  typeof value === "object" &&
  value !== null &&
  (value as { v?: unknown }).v === STORAGE_VERSION;

const loadStoredPreferences = (
  storageKey: string,
  defaults: UserPreferences,
): StoredPreferences => {
  const current = readStorageItem(storageKey);
  if (isCurrentVersion(current)) {
    return {
      ...EMPTY_STORED_PREFERENCES,
      ...parseUserState(current),
      overrides: parseOverrides(current.overrides),
    };
  }

  const legacy = readStorageItem(LEGACY_STORAGE_KEY);
  if (current === null && legacy === null) return EMPTY_STORED_PREFERENCES;

  // Version 1 stored the whole merged object on every write, server defaults
  // included, so one status-pill click froze every default in that browser.
  // A stored value can only be told apart from a frozen default where it
  // differs from the server's current one, so only those stay overrides. The
  // scoped entry still wins over v3's unscoped one.
  const values = { ...parseOverrides(legacy), ...parseOverrides(current) };
  const migrated: StoredPreferences = {
    ...EMPTY_STORED_PREFERENCES,
    ...parseUserState(legacy),
    ...parseUserState(current),
    overrides: (Object.keys(values) as PreferenceSetting[]).reduce(
      (overrides, key) => withOverride(overrides, key, values[key], defaults),
      {},
    ),
  };
  // Saved at once, judged against the defaults it was read with. Left in the
  // old format, it would be judged again against whatever the defaults are on
  // the next visit, and a value frozen from today's default would come back
  // as an override.
  writeStoredPreferences(storageKey, migrated);
  return migrated;
};

const createStorageKey = (basename: string, instanceId?: string): string => {
  const scope = instanceId?.trim() || basename || "default";
  return `queuedash:user-preferences:${encodeURIComponent(scope)}`;
};

export const QueuedashProvider = ({
  basename,
  children,
  ui,
}: PropsWithChildren<{
  basename: string;
  ui?: QueuedashUiConfig;
}>) => {
  const defaultPreferences = useMemo<UserPreferences>(
    () => ({
      defaultJobStatus: ui?.defaults?.defaultJobStatus ?? "completed",
      density: ui?.defaults?.density ?? "comfortable",
      jobsPerPage: ui?.defaults?.jobsPerPage ?? 30,
      lastJobStatus: "completed",
      pinnedQueues: [],
      theme: ui?.defaults?.theme ?? "system",
      refreshIntervalMs: clampRefreshInterval(
        ui?.defaults?.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      ),
      showOverviewMetrics: ui?.defaults?.showOverviewMetrics ?? true,
      timestamps: ui?.defaults?.timestamps ?? "absolute",
    }),
    [
      ui?.defaults?.defaultJobStatus,
      ui?.defaults?.density,
      ui?.defaults?.jobsPerPage,
      ui?.defaults?.refreshIntervalMs,
      ui?.defaults?.showOverviewMetrics,
      ui?.defaults?.theme,
      ui?.defaults?.timestamps,
    ],
  );
  const storageKey = createStorageKey(basename, ui?.instanceId);
  const preferenceScope = ui?.instanceId?.trim() || basename || "default";
  const [stored, setStored] = useState(() =>
    loadStoredPreferences(storageKey, defaultPreferences),
  );
  // Server defaults, then this browser's overrides, then the state that has
  // no server default. Derived rather than stored, so a changed server default
  // reaches every setting this browser has not overridden.
  const preferences = useMemo<UserPreferences>(
    () => ({
      ...defaultPreferences,
      ...stored.overrides,
      lastJobStatus: stored.lastJobStatus,
      pinnedQueues: stored.pinnedQueues,
    }),
    [defaultPreferences, stored],
  );
  const [portalContainer, setPortalContainer] = useState<Element | null>(null);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(THEME_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };

    setSystemDark(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
      return () => mediaQuery.removeEventListener("change", handleMediaChange);
    }

    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, []);

  const updateStored = useCallback(
    (update: (current: StoredPreferences) => StoredPreferences) => {
      setStored((current) => {
        const next = update(current);
        writeStoredPreferences(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const setOverride = useCallback(
    <Key extends PreferenceSetting>(key: Key, value: UserPreferences[Key]) =>
      updateStored((current) => ({
        ...current,
        overrides: withOverride(
          current.overrides,
          key,
          value,
          defaultPreferences,
        ),
      })),
    [defaultPreferences, updateStored],
  );

  const setTheme = useCallback(
    (theme: QueuedashTheme) => setOverride("theme", theme),
    [setOverride],
  );
  const setRefreshInterval = useCallback(
    (refreshIntervalMs: number | false) =>
      setOverride("refreshIntervalMs", clampRefreshInterval(refreshIntervalMs)),
    [setOverride],
  );
  const setJobsPerPage = useCallback(
    (jobsPerPage: UserPreferences["jobsPerPage"]) =>
      setOverride("jobsPerPage", jobsPerPage),
    [setOverride],
  );
  const setDefaultJobStatus = useCallback(
    (defaultJobStatus: QueuedashDefaultJobStatus) =>
      setOverride("defaultJobStatus", defaultJobStatus),
    [setOverride],
  );
  const setDensity = useCallback(
    (density: QueuedashDensity) => setOverride("density", density),
    [setOverride],
  );
  const setTimestamps = useCallback(
    (timestamps: QueuedashTimestampMode) =>
      setOverride("timestamps", timestamps),
    [setOverride],
  );
  const setShowOverviewMetrics = useCallback(
    (showOverviewMetrics: boolean) =>
      setOverride("showOverviewMetrics", showOverviewMetrics),
    [setOverride],
  );
  const setLastJobStatus = useCallback(
    (lastJobStatus: UserPreferences["lastJobStatus"]) =>
      updateStored((current) => ({ ...current, lastJobStatus })),
    [updateStored],
  );
  const setCodeLinks = useCallback(
    (codeLinks: CodeLinks) =>
      updateStored((current) => ({ ...current, codeLinks })),
    [updateStored],
  );
  const togglePinnedQueue = useCallback(
    (queueName: string) =>
      updateStored((current) => ({
        ...current,
        pinnedQueues: current.pinnedQueues.includes(queueName)
          ? current.pinnedQueues.filter((name) => name !== queueName)
          : [...current.pinnedQueues, queueName],
      })),
    [updateStored],
  );

  const resetPreferences = useCallback(() => {
    setStored(EMPTY_STORED_PREFERENCES);
    if (typeof window === "undefined") return;

    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Browser storage is an optional enhancement.
    }
  }, [storageKey]);

  const branding = useMemo<ResolvedBranding>(() => {
    const name = ui?.branding?.name?.trim() || DEFAULT_PRODUCT_NAME;
    return {
      name,
      logoUrl: ui?.branding?.logoUrl?.trim() || undefined,
      logoAlt: ui?.branding?.logoAlt?.trim() || name,
    };
  }, [ui?.branding?.logoAlt, ui?.branding?.logoUrl, ui?.branding?.name]);

  const value = useMemo<QueuedashContextValue>(
    () => ({
      branding,
      codeLinks: stored.codeLinks,
      defaultPreferences,
      documentTitle: ui?.documentTitle === true,
      isDark:
        preferences.theme === "dark" ||
        (preferences.theme === "system" && systemDark),
      overrides: stored.overrides,
      portalContainer,
      preferences,
      preferenceScope,
      resetPreferences,
      setCodeLinks,
      setDefaultJobStatus,
      setDensity,
      setJobsPerPage,
      setLastJobStatus,
      setPortalContainer,
      setRefreshInterval,
      setShowOverviewMetrics,
      setTheme,
      setTimestamps,
      togglePinnedQueue,
    }),
    [
      branding,
      defaultPreferences,
      ui?.documentTitle,
      stored.codeLinks,
      stored.overrides,
      portalContainer,
      preferenceScope,
      preferences,
      resetPreferences,
      setCodeLinks,
      setDefaultJobStatus,
      setDensity,
      setJobsPerPage,
      setLastJobStatus,
      setRefreshInterval,
      setShowOverviewMetrics,
      setTheme,
      setTimestamps,
      togglePinnedQueue,
      systemDark,
    ],
  );

  return (
    <QueuedashContext.Provider value={value}>
      {children}
    </QueuedashContext.Provider>
  );
};

export const useQueuedash = (): QueuedashContextValue => {
  const value = useContext(QueuedashContext);
  if (!value) {
    throw new Error("useQueuedash must be used inside QueuedashProvider");
  }
  return value;
};
