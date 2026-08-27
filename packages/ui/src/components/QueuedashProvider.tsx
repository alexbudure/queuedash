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

type ResolvedBranding = {
  name: string;
  logoUrl?: string;
  logoAlt: string;
};

type QueuedashContextValue = {
  branding: ResolvedBranding;
  defaultPreferences: UserPreferences;
  isDark: boolean;
  portalContainer: Element | null;
  preferences: UserPreferences;
  preferenceScope: string;
  resetPreferences: () => void;
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

const readStoredPreferences = (
  key: string,
): Partial<UserPreferences> | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      defaultJobStatus?: unknown;
      density?: unknown;
      jobsPerPage?: unknown;
      lastJobStatus?: unknown;
      pinnedQueues?: unknown;
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
  } catch {
    return null;
  }
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
  const [preferences, setPreferences] = useState<UserPreferences>(() => ({
    ...defaultPreferences,
    ...readStoredPreferences(LEGACY_STORAGE_KEY),
    ...readStoredPreferences(storageKey),
  }));
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

  const savePreferences = useCallback(
    (nextPreferences: UserPreferences) => {
      if (typeof window === "undefined") return;

      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(nextPreferences),
        );
      } catch {
        // Browser storage is an optional enhancement.
      }
    },
    [storageKey],
  );

  const setTheme = useCallback(
    (theme: QueuedashTheme) => {
      setPreferences((current) => {
        const next = { ...current, theme };
        savePreferences(next);
        return next;
      });
    },
    [savePreferences],
  );

  const setRefreshInterval = useCallback(
    (refreshIntervalMs: number | false) => {
      setPreferences((current) => {
        const next = {
          ...current,
          refreshIntervalMs: clampRefreshInterval(refreshIntervalMs),
        };
        savePreferences(next);
        return next;
      });
    },
    [savePreferences],
  );

  const updatePreference = useCallback(
    <Key extends keyof UserPreferences>(
      key: Key,
      value: UserPreferences[Key],
    ) => {
      setPreferences((current) => {
        const next = { ...current, [key]: value };
        savePreferences(next);
        return next;
      });
    },
    [savePreferences],
  );

  const setJobsPerPage = useCallback(
    (jobsPerPage: UserPreferences["jobsPerPage"]) =>
      updatePreference("jobsPerPage", jobsPerPage),
    [updatePreference],
  );
  const setDefaultJobStatus = useCallback(
    (defaultJobStatus: QueuedashDefaultJobStatus) =>
      updatePreference("defaultJobStatus", defaultJobStatus),
    [updatePreference],
  );
  const setLastJobStatus = useCallback(
    (lastJobStatus: UserPreferences["lastJobStatus"]) =>
      updatePreference("lastJobStatus", lastJobStatus),
    [updatePreference],
  );
  const setDensity = useCallback(
    (density: QueuedashDensity) => updatePreference("density", density),
    [updatePreference],
  );
  const setTimestamps = useCallback(
    (timestamps: QueuedashTimestampMode) =>
      updatePreference("timestamps", timestamps),
    [updatePreference],
  );
  const setShowOverviewMetrics = useCallback(
    (showOverviewMetrics: boolean) =>
      updatePreference("showOverviewMetrics", showOverviewMetrics),
    [updatePreference],
  );
  const togglePinnedQueue = useCallback(
    (queueName: string) => {
      setPreferences((current) => {
        const pinnedQueues = current.pinnedQueues.includes(queueName)
          ? current.pinnedQueues.filter((name) => name !== queueName)
          : [...current.pinnedQueues, queueName];
        const next = { ...current, pinnedQueues };
        savePreferences(next);
        return next;
      });
    },
    [savePreferences],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(defaultPreferences);
    if (typeof window === "undefined") return;

    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Browser storage is an optional enhancement.
    }
  }, [defaultPreferences, storageKey]);

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
      defaultPreferences,
      isDark:
        preferences.theme === "dark" ||
        (preferences.theme === "system" && systemDark),
      portalContainer,
      preferences,
      preferenceScope,
      resetPreferences,
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
      portalContainer,
      preferenceScope,
      preferences,
      resetPreferences,
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
