import { clsx } from "clsx";
import {
  Github,
  Layers,
  LogOut,
  Menu,
  Search,
  Settings,
  Star,
} from "lucide-react";
import {
  type FC,
  type PropsWithChildren,
  type ReactNode,
  useState,
} from "react";
import { NavLink } from "react-router";

import { trpc } from "../utils/trpc";
import { ErrorCard } from "./ErrorCard";
import { useQueuedashAuth } from "./QueuedashAuthProvider";
import { useQueuedash } from "./QueuedashProvider";
import { SidePanelDialog } from "./SidePanelDialog";
import { Skeleton } from "./Skeleton";
import { ThemeSwitcher } from "./ThemeSwitcher";

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
        <Layers className="size-5 shrink-0" strokeWidth={2.5} />
      )}
      <p className="truncate text-base font-semibold tracking-tight">
        {branding.name}
      </p>
    </NavLink>
  );
};

type QueueNavLinkProps = {
  to: string;
  label: string;
  isPinned: boolean;
  isReadOnly: boolean;
  onTogglePinned: () => void;
  onClick?: () => void;
};
const QueueNavLink = ({
  to,
  label,
  isPinned,
  isReadOnly,
  onTogglePinned,
  onClick,
}: QueueNavLinkProps) => {
  return (
    <div className="group/queue flex items-center gap-1">
      <NavLink
        to={to}
        onClick={onClick}
        className={({ isActive }) =>
          clsx(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 text-sm transition-all duration-150",
            {
              "font-semibold text-gray-900 dark:text-white": isActive,
              "font-medium text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300":
                !isActive,
            },
          )
        }
      >
        <span className="truncate">{label}</span>
        {isReadOnly ? (
          <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-[9px] tracking-wide text-gray-500 uppercase dark:bg-slate-800 dark:text-slate-400">
            Read-only
          </span>
        ) : null}
      </NavLink>
      <button
        type="button"
        onClick={onTogglePinned}
        aria-label={`${isPinned ? "Unpin" : "Pin"} ${label}`}
        title={`${isPinned ? "Unpin" : "Pin"} queue`}
        className={clsx(
          "flex size-6 shrink-0 items-center justify-center rounded text-gray-300 transition hover:text-amber-500 dark:text-slate-700 dark:hover:text-amber-400",
          isPinned
            ? "text-amber-500 opacity-100 dark:text-amber-400"
            : "opacity-0 group-hover/queue:opacity-100 focus:opacity-100",
        )}
      >
        <Star className="size-3" fill={isPinned ? "currentColor" : "none"} />
      </button>
    </div>
  );
};

const SidebarContent = ({
  data,
  isLoading,
  isError,
  onNavClick,
  showHeader = true,
}: {
  data:
    | {
        name: string;
        displayName: string;
        access: { mode: "full" | "read-only" | "hidden" };
      }[]
    | undefined;
  isLoading: boolean;
  isError: boolean;
  onNavClick?: () => void;
  showHeader?: boolean;
}) => {
  const { preferences, togglePinnedQueue } = useQueuedash();
  const { isSigningOut, signOut } = useQueuedashAuth();
  const [queueFilter, setQueueFilter] = useState("");
  const normalizedFilter = queueFilter.trim().toLocaleLowerCase();
  const sortedQueues = data
    ? [...data].sort((left, right) => {
        const leftPinned = preferences.pinnedQueues.includes(left.name);
        const rightPinned = preferences.pinnedQueues.includes(right.name);
        if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
        return left.displayName.localeCompare(right.displayName);
      })
    : undefined;
  const filteredQueues = normalizedFilter
    ? sortedQueues?.filter(
        (queue) =>
          queue.name.toLocaleLowerCase().includes(normalizedFilter) ||
          queue.displayName.toLocaleLowerCase().includes(normalizedFilter),
      )
    : sortedQueues;

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

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase dark:text-slate-600">
            Queues
          </div>
          {data ? (
            <span className="font-mono text-[10px] text-gray-300 dark:text-slate-700">
              {data.length}
            </span>
          ) : null}
        </div>

        {!isLoading && !isError && data && data.length > 5 ? (
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
            <input
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              placeholder="Filter queues"
              aria-label="Filter queues"
              className="h-8 w-full rounded-md border border-gray-200 bg-white pr-2 pl-8 text-xs text-gray-900 transition outline-none placeholder:text-gray-400 focus:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600"
            />
          </label>
        ) : null}

        <div className="space-y-0.5">
          {isLoading ? (
            Array.from({ length: 10 }, (_, i) => {
              return <Skeleton className="h-8 w-full rounded-md" key={i} />;
            })
          ) : isError ? (
            <ErrorCard message="Could not fetch queues" />
          ) : filteredQueues?.length ? (
            filteredQueues.map((queue) => {
              return (
                <QueueNavLink
                  key={queue.name}
                  to={`../${encodeURIComponent(queue.name)}`}
                  label={queue.displayName}
                  isPinned={preferences.pinnedQueues.includes(queue.name)}
                  isReadOnly={queue.access.mode === "read-only"}
                  onTogglePinned={() => togglePinnedQueue(queue.name)}
                  onClick={onNavClick}
                />
              );
            })
          ) : (
            <div className="py-3 text-xs text-gray-400 dark:text-slate-600">
              {normalizedFilter ? "No matching queues" : "No queues found"}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-200/80 pt-3 dark:border-slate-800">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1">
            <a
              href="https://github.com/alexbudure/queuedash"
              target="_blank"
              rel="noreferrer"
              aria-label="Queuedash on GitHub"
              className="flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-900 dark:text-slate-600 dark:hover:text-white"
            >
              <Github size={15} />
            </a>
            <NavLink
              to="../settings"
              onClick={onNavClick}
              aria-label="Settings"
              className={({ isActive }) =>
                clsx(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  isActive
                    ? "bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-white"
                    : "text-gray-400 hover:text-gray-900 dark:text-slate-600 dark:hover:text-white",
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
                className="flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-600 dark:hover:text-white"
              >
                <LogOut
                  size={15}
                  className={isSigningOut ? "animate-pulse" : undefined}
                />
              </button>
            ) : null}
          </div>

          <ThemeSwitcher />
        </div>
      </div>
    </div>
  );
};

const MobileNav = ({
  data,
  isLoading,
  isError,
}: {
  data:
    | {
        name: string;
        displayName: string;
        access: { mode: "full" | "read-only" | "hidden" };
      }[]
    | undefined;
  isLoading: boolean;
  isError: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const { branding } = useQueuedash();

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-gray-100/60 bg-white/90 px-4 py-3 backdrop-blur-md xl:hidden dark:border-slate-800/60 dark:bg-slate-900/90">
        <BrandLink />
        <button
          onClick={() => setOpen(true)}
          className="flex size-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-900 dark:text-slate-500 dark:hover:text-white"
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
              isLoading={isLoading}
              isError={isError}
              onNavClick={() => setOpen(false)}
              showHeader={false}
            />
          </div>
        </SidePanelDialog>
      )}
    </>
  );
};

type LayoutProps = PropsWithChildren<{
  top?: ReactNode;
}>;

export const Layout: FC<LayoutProps> = ({ children, top }) => {
  const { preferences } = useQueuedash();
  const { data, isLoading, isError } = trpc.queue.list.useQuery(undefined, {
    refetchInterval: preferences.refreshIntervalMs,
  });

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <MobileNav data={data} isLoading={isLoading} isError={isError} />

      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 xl:sticky xl:top-0 xl:block xl:h-screen">
        <div className="flex h-screen flex-col px-5 py-4">
          <SidebarContent data={data} isLoading={isLoading} isError={isError} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1700px] pt-14 xl:py-3 xl:pr-4">
          {top ? <div className="mb-3 hidden px-1 xl:block">{top}</div> : null}
          <div className="min-h-[calc(100vh-3.5rem)] bg-white p-4 xl:min-h-[calc(100vh-3.25rem)] xl:rounded-2xl xl:border xl:border-gray-100/60 xl:p-6 xl:shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] dark:bg-slate-900 xl:dark:border-slate-800/40 xl:dark:shadow-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
