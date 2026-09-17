import { clsx } from "clsx";
import {
  Github,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Pause,
  Search,
  Settings,
  Star,
} from "lucide-react";
import { type FC, type PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { formatCompactCount, formatDuration } from "../utils/format";
import {
  FOCUS_FIELD,
  FOCUS_RING,
  INPUT_CLASS_COMPACT,
  SECTION_LABEL,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import { trpc } from "../utils/trpc";
import { getQueuePath } from "../utils/viewState";
import { CommandPalette } from "./CommandPalette";
import { ErrorCard } from "./ErrorCard";
import { QueuedashIcon } from "./Logo";
import { useQueuedashAuth } from "./QueuedashAuthProvider";
import { useQueuedash } from "./QueuedashProvider";
import { SidePanelDialog } from "./SidePanelDialog";
import { Skeleton } from "./Skeleton";

type QueueSummary = {
  name: string;
  displayName: string;
  access: { mode: "full" | "read-only" | "hidden" };
  paused: boolean | null;
  failedCount: number | null;
};

const KBD_CLASS =
  "rounded border border-gray-200 px-1 font-mono text-[10px] leading-4 text-gray-500 dark:border-slate-700 dark:text-slate-400";

const BrandLink = ({ onClick }: { onClick?: () => void }) => {
  const { branding } = useQueuedash();

  return (
    <NavLink
      to="../"
      onClick={onClick}
      aria-label={branding.name}
      className="flex min-w-0 items-center gap-2.5 text-gray-900 dark:text-white"
    >
      {branding.logoUrl ? (
        // oxlint-disable-next-line next/no-img-element -- Shared UI cannot depend on a framework image component.
        <img
          src={branding.logoUrl}
          alt={branding.logoAlt}
          className="h-5 max-w-28 shrink-0 object-contain"
        />
      ) : (
        <QueuedashIcon className="size-5 shrink-0" />
      )}
      <p className="truncate text-base font-semibold tracking-tight">
        {branding.name}
      </p>
    </NavLink>
  );
};

/**
 * The refresh interval is user-settable to Off, so without this the sidebar
 * cannot be told apart from one whose polling stopped days ago. The dot is the
 * dashboard's own pulse: green while polling keeps up, amber once a poll is
 * overdue (a backgrounded tab, a slow server), grey when refresh is off.
 */
const LiveStatus = ({ dataUpdatedAt }: { dataUpdatedAt: number }) => {
  const { preferences } = useQueuedash();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) return null;

  const elapsed = Math.max(0, now - dataUpdatedAt);
  const interval = preferences.refreshIntervalMs;
  const ago = `${formatDuration(elapsed)} ago`;
  const state =
    interval === false
      ? { dot: "bg-gray-400 dark:bg-slate-500", label: `Refresh off · ${ago}` }
      : elapsed > interval + 10_000
        ? { dot: "bg-amber-500", label: `Stale · ${ago}` }
        : elapsed < 10_000
          ? { dot: "animate-heartbeat bg-green-500", label: "Live" }
          : { dot: "bg-green-500", label: `Live · ${ago}` };

  return (
    <p className={clsx("flex items-center gap-1.5 text-[11px]", TEXT_MUTED)}>
      <span
        aria-hidden="true"
        className={clsx("size-1.5 shrink-0 rounded-full", state.dot)}
      />
      <span className="sr-only">Queue list </span>
      {state.label}
    </p>
  );
};

const NAV_LINK =
  "flex min-w-0 items-center gap-2 rounded-md py-1.5 text-sm transition-colors duration-150";

const navLinkClass = (isActive: boolean) =>
  clsx(
    NAV_LINK,
    FOCUS_RING,
    isActive
      ? "font-semibold text-gray-900 active:text-gray-600 dark:text-white dark:active:text-slate-300"
      : "font-medium text-gray-700 hover:text-gray-900 active:text-gray-500 dark:text-slate-300 dark:hover:text-white dark:active:text-slate-400",
  );

type QueueNavLinkProps = {
  to: string;
  label: string;
  isPinned: boolean;
  isReadOnly: boolean;
  isPaused: boolean;
  failedCount: number | null;
  onTogglePinned: () => void;
  onClick?: () => void;
  alwaysShowPin?: boolean;
};
const QueueNavLink = ({
  to,
  label,
  isPinned,
  isReadOnly,
  isPaused,
  failedCount,
  onTogglePinned,
  onClick,
  alwaysShowPin = false,
}: QueueNavLinkProps) => {
  const hasTrailing = !!failedCount || isPaused || isReadOnly;
  return (
    <div className="group/queue flex items-center">
      <NavLink
        to={to}
        onClick={onClick}
        // Not `transition-all`: Inter is a variable font, so interpolating
        // the weight axis reflows the label inside its `truncate` box.
        className={({ isActive }) => clsx(navLinkClass(isActive), "flex-1")}
      >
        <span className="truncate" title={label}>
          {label}
        </span>
        {/* Glyphs, not pills: at sidebar width a pill cost the queue its own
            name ("Payment processi… Read-only"). They share the star's column
            so every row's trailing icons line up. */}
        {hasTrailing ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
            {failedCount ? (
              <span
                title={`${formatCompactCount(failedCount)} failed`}
                className="font-mono text-[11px] text-red-600 tabular-nums dark:text-red-400"
              >
                {formatCompactCount(failedCount)}
                <span className="sr-only"> failed</span>
              </span>
            ) : null}
            {isPaused ? (
              <span title="Paused" className="flex">
                <Pause
                  aria-hidden="true"
                  className={clsx("size-3", TEXT_FAINT)}
                />
                <span className="sr-only">(paused)</span>
              </span>
            ) : null}
            {isReadOnly ? (
              <span title="Read-only" className="flex">
                <LockKeyhole
                  aria-hidden="true"
                  className={clsx("size-3", TEXT_FAINT)}
                />
                <span className="sr-only">(read-only)</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </NavLink>
      <button
        type="button"
        onClick={onTogglePinned}
        aria-label={`${isPinned ? "Unpin" : "Pin"} ${label}`}
        title={`${isPinned ? "Unpin" : "Pin"} queue`}
        // Takes no width until the row is hovered (or the star has focus, or
        // the queue is pinned), so the trailing glyphs sit on the right edge
        // and slide left to make room for it.
        className={clsx(
          "flex h-6 shrink-0 items-center justify-end overflow-hidden rounded text-gray-500 transition-all duration-150 hover:text-amber-500 active:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 dark:active:text-amber-300",
          FOCUS_RING,
          isPinned
            ? "w-6 text-amber-500 opacity-100 dark:text-amber-400"
            : alwaysShowPin
              ? "w-6 opacity-100"
              : "w-0 opacity-0 group-hover/queue:w-6 group-hover/queue:opacity-100 focus-visible:w-6 focus-visible:opacity-100",
        )}
      >
        <Star className="size-3" fill={isPinned ? "currentColor" : "none"} />
      </button>
    </div>
  );
};

const SidebarContent = ({
  data,
  dataUpdatedAt,
  isLoading,
  isError,
  onRetry,
  isRetrying,
  onNavClick,
  onOpenPalette,
  showHeader = true,
}: {
  data: QueueSummary[] | undefined;
  dataUpdatedAt: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  onNavClick?: () => void;
  onOpenPalette: () => void;
  showHeader?: boolean;
}) => {
  const { preferences, togglePinnedQueue } = useQueuedash();
  const { isSigningOut, signOut } = useQueuedashAuth();
  const [queueFilter, setQueueFilter] = useState("");
  const normalizedFilter = queueFilter.trim().toLocaleLowerCase();
  const isPinned = (queue: QueueSummary) =>
    preferences.pinnedQueues.includes(queue.name);
  const sortedQueues = data
    ? [...data].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      )
    : undefined;
  const filteredQueues = normalizedFilter
    ? sortedQueues?.filter(
        (queue) =>
          queue.name.toLocaleLowerCase().includes(normalizedFilter) ||
          queue.displayName.toLocaleLowerCase().includes(normalizedFilter),
      )
    : sortedQueues;
  // Pinned queues used to lead the one list with only a filled star to say
  // so. A group of their own is what the star was standing in for.
  const pinnedQueues = filteredQueues?.filter(isPinned) ?? [];
  const otherQueues = filteredQueues?.filter((queue) => !isPinned(queue)) ?? [];
  const otherQueueCount = data?.filter((queue) => !isPinned(queue)).length;
  const isReady = !isLoading && !isError && !!data;

  const renderQueue = (queue: QueueSummary) => (
    <QueueNavLink
      key={queue.name}
      to={getQueuePath(queue.name)}
      label={queue.displayName}
      isPinned={isPinned(queue)}
      isReadOnly={queue.access.mode === "read-only"}
      isPaused={queue.paused === true}
      failedCount={queue.failedCount}
      onTogglePinned={() => togglePinnedQueue(queue.name)}
      onClick={onNavClick}
      alwaysShowPin={!showHeader}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeader && (
        <>
          <div className="pt-3 pb-4">
            <BrandLink onClick={onNavClick} />
          </div>

          <div className="border-t border-gray-200/80 dark:border-slate-800" />
        </>
      )}

      {/* The overview is the front door, so it gets a door: before this the
          only way back to it was the logo, which nobody reads as a link. */}
      <nav aria-label="Dashboard" className="py-3">
        <NavLink
          to="../"
          end
          onClick={onNavClick}
          className={({ isActive }) => navLinkClass(isActive)}
        >
          {({ isActive }) => (
            <>
              <LayoutGrid
                aria-hidden="true"
                className={clsx(
                  "size-4 shrink-0",
                  isActive
                    ? "text-gray-900 dark:text-white"
                    : "text-gray-500 dark:text-slate-400",
                )}
              />
              Overview
            </>
          )}
        </NavLink>
        <button
          type="button"
          onClick={() => {
            onNavClick?.();
            onOpenPalette();
          }}
          className={clsx(navLinkClass(false), "w-full")}
        >
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-gray-500 dark:text-slate-400"
          />
          Search
          <kbd aria-hidden="true" className={clsx("ml-auto", KBD_CLASS)}>
            ⌘K
          </kbd>
        </button>
      </nav>

      <div className="border-t border-gray-200/80 dark:border-slate-800" />

      <nav aria-label="Queues" className="min-h-0 flex-1 overflow-y-auto py-4">
        {isReady && (data.length > 5 || queueFilter.length > 0) ? (
          <label className="relative mb-3 block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-500 dark:text-slate-400"
            />
            <input
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              placeholder="Filter queues"
              aria-label="Filter queues"
              className={clsx(INPUT_CLASS_COMPACT, FOCUS_FIELD, "pr-2 pl-8")}
            />
          </label>
        ) : null}

        {isReady && pinnedQueues.length > 0 ? (
          <div className="mb-4">
            <div className={clsx("mb-2", SECTION_LABEL)}>Pinned</div>
            <div className="space-y-0.5">{pinnedQueues.map(renderQueue)}</div>
          </div>
        ) : null}

        <div className="mb-2 flex items-center justify-between">
          <div className={SECTION_LABEL}>Queues</div>
          {otherQueueCount !== undefined ? (
            <span className={clsx("font-mono text-[10px]", TEXT_MUTED)}>
              {otherQueueCount}
            </span>
          ) : null}
        </div>

        <div className="space-y-0.5">
          {isLoading ? (
            Array.from({ length: 10 }, (_, i) => {
              return <Skeleton className="h-8 w-full rounded-md" key={i} />;
            })
          ) : isError ? (
            <ErrorCard
              title="Could not fetch queues"
              message="The dashboard could not reach Redis."
              onRetry={onRetry}
              isRetrying={isRetrying}
            />
          ) : otherQueues.length ? (
            otherQueues.map(renderQueue)
          ) : pinnedQueues.length ? null : normalizedFilter ? (
            <div className="py-3">
              <p className={clsx("text-xs", TEXT_MUTED)}>
                No queues match “{queueFilter.trim()}”.
              </p>
              <button
                type="button"
                onClick={() => setQueueFilter("")}
                className={clsx(
                  "mt-1.5 rounded text-xs font-medium text-brand-600 hover:underline active:text-brand-800 dark:text-brand-400 dark:active:text-brand-300",
                  FOCUS_RING,
                )}
              >
                Clear filter
              </button>
            </div>
          ) : (
            <p className={clsx("py-3 text-xs", TEXT_MUTED)}>
              No queues are registered with this dashboard.
            </p>
          )}
        </div>
      </nav>

      {/* Liveness on the left, the doors out on the right. The theme switcher
          moved to Settings › Appearance: a three-way control most people touch
          once did not earn a permanent slot here. */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200/80 pt-3 dark:border-slate-800">
        <LiveStatus dataUpdatedAt={dataUpdatedAt} />

        <div className="flex items-center gap-1">
          <a
            href="https://github.com/alexbudure/queuedash"
            target="_blank"
            rel="noreferrer"
            aria-label="Queuedash on GitHub"
            className={clsx(
              "flex size-7 items-center justify-center rounded-md transition-colors duration-150 hover:text-gray-900 active:bg-gray-100 dark:hover:text-white dark:active:bg-slate-800",
              TEXT_MUTED,
              FOCUS_RING,
            )}
          >
            <Github size={15} />
          </a>
          <NavLink
            to="../settings"
            onClick={onNavClick}
            aria-label="Settings"
            className={({ isActive }) =>
              clsx(
                "flex size-7 items-center justify-center rounded-md transition-colors duration-150",
                FOCUS_RING,
                isActive
                  ? "bg-gray-100 text-gray-900 active:bg-gray-200 dark:bg-slate-800 dark:text-white dark:active:bg-slate-700"
                  : `${TEXT_MUTED} hover:text-gray-900 active:bg-gray-100 dark:hover:text-white dark:active:bg-slate-800`,
              )
            }
          >
            <Settings size={15} />
          </NavLink>
          {signOut ? (
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={isSigningOut}
              aria-label="Sign out"
              title="Sign out"
              className={clsx(
                "flex size-7 items-center justify-center rounded-md transition-colors duration-150 hover:text-gray-900 active:bg-gray-100 disabled:opacity-50 dark:hover:text-white dark:active:bg-slate-800",
                TEXT_MUTED,
                FOCUS_RING,
              )}
            >
              {isSigningOut ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <LogOut size={15} />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const MobileNav = ({
  data,
  dataUpdatedAt,
  isLoading,
  isError,
  onRetry,
  isRetrying,
  onOpenPalette,
}: {
  data: QueueSummary[] | undefined;
  dataUpdatedAt: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  onOpenPalette: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const { branding } = useQueuedash();

  return (
    <>
      {/* h-14 (border-box) so this matches the `pt-14` offset below exactly. */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-gray-100/60 bg-white/90 px-4 backdrop-blur-md lg:hidden dark:border-slate-800/60 dark:bg-slate-900/90">
        <BrandLink />
        <button
          onClick={() => setOpen(true)}
          className={clsx(
            "flex size-8 items-center justify-center rounded-md transition-colors duration-150 hover:text-gray-900 active:bg-gray-100 dark:hover:text-white dark:active:bg-slate-800",
            TEXT_MUTED,
            FOCUS_RING,
          )}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {open && (
        <SidePanelDialog
          title={branding.name}
          open={open}
          onOpenChange={setOpen}
          panelClassName="!max-w-[288px]"
        >
          <div className="flex h-full flex-col px-5 py-4">
            <SidebarContent
              data={data}
              dataUpdatedAt={dataUpdatedAt}
              isLoading={isLoading}
              isError={isError}
              onRetry={onRetry}
              isRetrying={isRetrying}
              onNavClick={() => setOpen(false)}
              onOpenPalette={onOpenPalette}
              showHeader={false}
            />
          </div>
        </SidePanelDialog>
      )}
    </>
  );
};

const getPageTitle = (
  pathname: string,
  queues: QueueSummary[] | undefined,
): string => {
  const path = pathname.replace(/\/+$/, "");
  if (path === "") return "Overview";
  if (path === "/settings") return "Settings";

  const queueName = decodeURIComponent(path.replace(/^\/(queues\/)?/, ""));
  return (
    queues?.find((queue) => queue.name === queueName)?.displayName ?? queueName
  );
};

export const Layout: FC<PropsWithChildren> = ({ children }) => {
  const { branding, documentTitle, portalContainer, preferences } =
    useQueuedash();
  const { pathname } = useLocation();
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const {
    data,
    dataUpdatedAt,
    isLoading,
    isError,
    refetch: onRetry,
    isRefetching: isRetrying,
  } = trpc.queue.list.useQuery(undefined, {
    refetchInterval: preferences.refreshIntervalMs,
  });

  // Off by default: the dashboard usually mounts inside a host app that owns
  // its own title.
  useEffect(() => {
    if (!documentTitle) return;
    const hostTitle = document.title;
    return () => {
      document.title = hostTitle;
    };
  }, [documentTitle]);

  useEffect(() => {
    if (!documentTitle) return;
    document.title = `${getPageTitle(pathname, data)} · ${branding.name}`;
  }, [branding.name, data, documentTitle, pathname]);

  // Cmd-K / Ctrl-K. Gated like QueuePage's shortcuts: a keystroke aimed at
  // something outside the dashboard belongs to the host app.
  useEffect(() => {
    const root = portalContainer;
    if (!root) return;
    const doc = root.ownerDocument;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isOurs =
        !target ||
        target === doc.body ||
        target === doc.documentElement ||
        root.contains(target);
      if (!isOurs) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [portalContainer]);

  return (
    <div className="relative min-h-screen">
      <a
        href="#queuedash-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:ring-2 focus:ring-brand-400 dark:focus:bg-slate-900 dark:focus:text-white"
      >
        Skip to content
      </a>

      <CommandPalette
        open={isPaletteOpen}
        onOpenChange={setPaletteOpen}
        queues={data}
      />

      <MobileNav
        data={data}
        dataUpdatedAt={dataUpdatedAt}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        isRetrying={isRetrying}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {/* One clamp around the nav and the content together, so the card stays
          attached to the sidebar on an ultrawide display. */}
      <div className="mx-auto flex min-h-screen w-full max-w-[1700px]">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 lg:sticky lg:top-0 lg:block lg:h-screen">
          <div className="flex h-screen flex-col px-5 py-4">
            <SidebarContent
              data={data}
              dataUpdatedAt={dataUpdatedAt}
              isLoading={isLoading}
              isError={isError}
              onRetry={onRetry}
              isRetrying={isRetrying}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          </div>
        </aside>

        {/* `--qd-top-inset` is what the mobile nav covers, for anything
            pinned to the top of the page - the same offset as `pt-14`. */}
        <main
          id="queuedash-main"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col pt-14 outline-none [--qd-top-inset:3.5rem] lg:py-3 lg:pr-4 lg:[--qd-top-inset:0px]"
        >
          <div className="min-w-0 flex-1 bg-white p-4 lg:rounded-2xl lg:border lg:border-gray-100/60 lg:p-6 lg:shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] dark:bg-slate-900 lg:dark:border-slate-800/40 lg:dark:shadow-none">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
