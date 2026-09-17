import { clsx } from "clsx";
import {
  Calendar,
  LayoutGrid,
  LockKeyhole,
  Search,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Autocomplete,
  Dialog,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Modal,
  ModalOverlay,
  SearchField,
  useFilter,
} from "react-aria-components";
import { useLocation, useNavigate } from "react-router";

import { formatCount } from "../utils/format";
import { STATUS_ICONS, STATUS_LABELS, STATUS_ORDER } from "../utils/status";
import {
  OVERLAY_ITEM,
  OVERLAY_SURFACE,
  SECTION_LABEL,
  TEXT_FAINT,
  TEXT_MUTED,
  Z_INDEX,
} from "../utils/styles";
import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";

type QueueSummary = {
  name: string;
  displayName: string;
  access: { mode: "full" | "read-only" | "hidden" };
};

/** The queue the palette was opened on, from the same paths the router serves. */
const getQueueNameFromPath = (pathname: string): string | null => {
  const path = pathname.replace(/\/+$/, "");
  if (path === "" || path === "/settings") return null;
  return decodeURIComponent(path.replace(/^\/(queues\/)?/, ""));
};

const ITEM_CLASS = ({
  isFocused,
  isHovered,
}: {
  isFocused: boolean;
  isHovered: boolean;
}) =>
  clsx(
    OVERLAY_ITEM,
    "justify-between gap-3 text-gray-700 transition-colors duration-150 dark:text-slate-300",
    (isFocused || isHovered) &&
      "bg-gray-100 text-gray-900 dark:bg-slate-700/60 dark:text-white",
  );

const Item = ({
  id,
  label,
  icon,
  trailing,
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}) => (
  <ListBoxItem id={id} textValue={label} className={ITEM_CLASS}>
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className={clsx(
          "flex size-4 shrink-0 items-center justify-center",
          TEXT_FAINT,
        )}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </span>
    {trailing}
  </ListBoxItem>
);

const SectionHeader = ({ children }: { children: ReactNode }) => (
  <Header className={clsx("px-2.5 pt-2.5 pb-1.5", SECTION_LABEL)}>
    {children}
  </Header>
);

/**
 * Cmd-K. With a handful of queues the sidebar filter is enough; with forty it
 * is not, and the palette is also the only place a status or the settings can
 * be reached without the mouse.
 */
export const CommandPalette = ({
  open,
  onOpenChange,
  queues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queues: QueueSummary[] | undefined;
}) => {
  const { portalContainer, preferences } = useQueuedash();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { contains } = useFilter({ sensitivity: "base" });

  const currentQueueName = getQueueNameFromPath(pathname);
  const currentQueue = trpc.queue.byName.useQuery(
    { queueName: currentQueueName ?? "" },
    { enabled: open && !!currentQueueName },
  ).data;
  const currentQueuePath = currentQueueName
    ? `/queues/${encodeURIComponent(currentQueueName)}`
    : null;
  // Same order as the sidebar: pinned first, then by name.
  const isPinned = (queue: QueueSummary) =>
    preferences.pinnedQueues.includes(queue.name);
  const sortedQueues = [...(queues ?? [])].sort((left, right) => {
    const pinnedDelta = Number(isPinned(right)) - Number(isPinned(left));
    return pinnedDelta || left.displayName.localeCompare(right.displayName);
  });
  // Same order as the status pills, not the adapter's.
  const currentStatuses = currentQueue
    ? STATUS_ORDER.filter((status) =>
        (currentQueue.supports.statuses as readonly string[]).includes(status),
      )
    : [];

  const go = (key: string) => {
    const [kind, ...rest] = key.split(":");
    const value = rest.join(":");
    if (kind === "page") navigate(value);
    else if (kind === "queue") navigate(`/queues/${encodeURIComponent(value)}`);
    else if (kind === "status" && currentQueuePath) {
      navigate(`${currentQueuePath}?status=${value}`);
    } else if (kind === "view" && currentQueuePath) {
      navigate(`${currentQueuePath}?view=${value}`);
    }
    onOpenChange(false);
  };

  return (
    <ModalOverlay
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      style={{ zIndex: Z_INDEX.dialog }}
      className="alert-overlay fixed inset-0 flex items-start justify-center bg-black/[0.08] p-4 pt-[12vh] backdrop-blur-[2px] dark:bg-black/65"
    >
      <Modal
        className={clsx(
          "alert-dialog w-full max-w-lg overflow-hidden",
          OVERLAY_SURFACE,
        )}
      >
        <Dialog aria-label="Search" className="outline-none">
          <Autocomplete filter={contains}>
            <SearchField
              aria-label="Search queues and pages"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- The field is the palette's only content until it is typed in.
              autoFocus
              className="flex items-center gap-2.5 border-b border-gray-100 px-3.5 dark:border-slate-700/60"
            >
              <Search
                aria-hidden="true"
                className={clsx("size-4 shrink-0", TEXT_FAINT)}
              />
              <Input
                placeholder="Jump to a queue, a status, or a page…"
                className="h-12 min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-500 dark:text-white dark:placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
              />
              <kbd
                className={clsx(
                  "hidden rounded border border-gray-200 px-1.5 font-mono text-[10px] leading-4 sm:block dark:border-slate-700",
                  TEXT_MUTED,
                )}
              >
                esc
              </kbd>
            </SearchField>

            <ListBox
              aria-label="Results"
              onAction={(key) => go(String(key))}
              className="qd-scroll qd-scroll-contain max-h-[50vh] overflow-y-auto p-1.5 outline-none"
              renderEmptyState={() => (
                <p
                  className={clsx(
                    "px-2.5 py-6 text-center text-sm",
                    TEXT_MUTED,
                  )}
                >
                  Nothing matches.
                </p>
              )}
            >
              {currentQueue && currentQueuePath ? (
                <ListBoxSection id="here">
                  <SectionHeader>{currentQueue.displayName}</SectionHeader>
                  {currentStatuses.map((status) => {
                    const Icon = STATUS_ICONS[status];
                    const count = currentQueue.counts[status] ?? 0;
                    return (
                      <Item
                        key={status}
                        id={`status:${status}`}
                        label={STATUS_LABELS[status]}
                        icon={<Icon className="size-3.5" />}
                        trailing={
                          <span
                            className={clsx(
                              "font-mono text-xs tabular-nums",
                              count === 0 ? TEXT_FAINT : TEXT_MUTED,
                            )}
                          >
                            {formatCount(count)}
                          </span>
                        }
                      />
                    );
                  })}
                  {currentQueue.supports.schedulers ? (
                    <Item
                      id="view:schedulers"
                      label="Schedulers"
                      icon={<Calendar className="size-3.5" />}
                    />
                  ) : null}
                </ListBoxSection>
              ) : null}

              <ListBoxSection id="queues">
                <SectionHeader>Queues</SectionHeader>
                {sortedQueues.map((queue) => (
                  <Item
                    key={queue.name}
                    id={`queue:${queue.name}`}
                    label={queue.displayName}
                    trailing={
                      queue.access.mode === "read-only" ? (
                        <LockKeyhole
                          aria-label="Read-only"
                          className={clsx("size-3 shrink-0", TEXT_FAINT)}
                        />
                      ) : null
                    }
                  />
                ))}
              </ListBoxSection>

              <ListBoxSection id="pages">
                <SectionHeader>Pages</SectionHeader>
                <Item
                  id="page:/"
                  label="Overview"
                  icon={<LayoutGrid className="size-3.5" />}
                />
                <Item
                  id="page:/settings"
                  label="Settings"
                  icon={<Settings className="size-3.5" />}
                />
              </ListBoxSection>
            </ListBox>
          </Autocomplete>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
};
