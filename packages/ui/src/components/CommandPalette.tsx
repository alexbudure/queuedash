import { clsx } from "clsx";
import {
  AlertTriangle,
  Calendar,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  Search,
  Settings,
  Shapes,
  Star,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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

import { formatJobId } from "../utils/flow";
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
import type { Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";

type QueueSummary = {
  name: string;
  displayName: string;
  access: { mode: "full" | "read-only" | "hidden" };
};

/**
 * `decodeURIComponent` throws on a malformed escape: a v3 bookmark such as
 * `/100%` (v3 did not encode queue names in its links) or a truncated `%2`.
 * The palette is always mounted, so that one URL blanked the whole dashboard.
 * The raw segment is what the router's own params fall back to, so the page
 * and the palette still agree on the queue name.
 */
export const decodePathSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** The queue the palette was opened on, from the same paths the router serves. */
const getQueueNameFromPath = (pathname: string): string | null => {
  const path = pathname.replace(/\/+$/, "");
  if (path === "" || path === "/settings") return null;
  return decodePathSegment(path.replace(/^\/(queues\/)?/, ""));
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

// Two characters before the server scans every queue for them.
const MIN_FIND_LENGTH = 2;
const FIND_DEBOUNCE_MS = 250;
const JOB_KEY = "job:";

const STATUS_ICON_TONES: Partial<Record<Status, string>> = {
  failed: "text-red-500 dark:text-red-400",
  completed: "text-green-600 dark:text-green-400",
  active: "text-blue-500 dark:text-blue-400",
};

const useDebouncedValue = (value: string, ms: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return debounced;
};

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
  const { portalContainer, preferences, togglePinnedQueue } = useQueuedash();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { contains } = useFilter({ sensitivity: "base" });
  const [inputValue, setInputValue] = useState("");
  // A fresh palette starts empty, like it did before it kept its text.
  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);
  // Any job in any queue the viewer can see, by id or by text: the ticket
  // quotes a job id and nobody knows its queue.
  const findQuery = useDebouncedValue(inputValue.trim(), FIND_DEBOUNCE_MS);
  const canFind = open && findQuery.length >= MIN_FIND_LENGTH;
  const findReq = trpc.job.find.useQuery(
    { query: findQuery, limit: 8 },
    { enabled: canFind, retry: false, staleTime: 5_000 },
  );
  // Refused while job ids are redacted: the palette just doesn't offer jobs.
  const foundJobs = canFind && !findReq.isError ? findReq.data?.results : [];
  // From the first keystroke, not the debounced one: in between, the list
  // said "Nothing matches." about a search that hadn't run yet.
  // Typing focuses the first row that matches, but the server's jobs land
  // after that: with nothing else matching, Enter did nothing. Once they
  // arrive, the first one takes focus, unless a row already has it. The
  // event is the one react-aria's Autocomplete sends for the same purpose.
  const listRef = useRef<HTMLDivElement>(null);
  const firstFoundKey = foundJobs?.[0]
    ? `${foundJobs[0].queueName}:${foundJobs[0].job.id}`
    : null;
  useEffect(() => {
    const list = listRef.current;
    if (!firstFoundKey || !list || list.querySelector("[data-focused]")) {
      return;
    }
    list.dispatchEvent(
      new CustomEvent("react-aria-focus", {
        cancelable: true,
        bubbles: true,
        detail: { focusStrategy: "first" },
      }),
    );
  }, [firstFoundKey]);
  const isFinding =
    open &&
    inputValue.trim().length >= MIN_FIND_LENGTH &&
    (findReq.isFetching || inputValue.trim() !== findQuery) &&
    !findReq.isError;

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
  // BullMQ lists Paused on every queue so a backlog a BullMQ 5 producer parked
  // there stays visible; like the status pills, offer it only when it holds jobs.
  const currentStatuses = currentQueue
    ? STATUS_ORDER.filter(
        (status) =>
          (currentQueue.supports.statuses as readonly string[]).includes(
            status,
          ) &&
          (status !== "paused" || (currentQueue.counts.paused ?? 0) > 0),
      )
    : [];

  const go = (key: string) => {
    if (key.startsWith(JOB_KEY)) {
      const [queueName = "", status = "", jobId = ""] = key
        .slice(JOB_KEY.length)
        .split(":")
        .map(decodeURIComponent);
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      params.set("job", jobId);
      navigate(`/queues/${encodeURIComponent(queueName)}?${params}`);
      onOpenChange(false);
      return;
    }
    const [kind, ...rest] = key.split(":");
    const value = rest.join(":");
    if (kind === "page") navigate(value);
    else if (kind === "queue") navigate(`/queues/${encodeURIComponent(value)}`);
    else if (kind === "status" && currentQueuePath) {
      navigate(`${currentQueuePath}?status=${value}`);
    } else if (kind === "view" && currentQueuePath) {
      navigate(`${currentQueuePath}?view=${value}`);
    } else if (kind === "action" && value === "pin" && currentQueueName) {
      togglePinnedQueue(currentQueueName);
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
          <Autocomplete
            inputValue={inputValue}
            onInputChange={setInputValue}
            // The server already matched the jobs, often on data their names
            // don't show, so only the palette's own items are filtered here.
            filter={(textValue, query, node) =>
              String(node.key).startsWith(JOB_KEY) || contains(textValue, query)
            }
          >
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
                placeholder="Find a job, or jump to a queue or a page…"
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
              ref={listRef}
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
              {isFinding || (foundJobs && foundJobs.length > 0) ? (
                <ListBoxSection id="jobs">
                  <SectionHeader>Jobs</SectionHeader>
                  {foundJobs?.map(
                    ({ job, queueName, queueDisplayName, status }) => {
                      const listStatus = status as Status | null;
                      const Icon = listStatus ? STATUS_ICONS[listStatus] : null;
                      const label = job.name?.trim() || `#${job.id}`;
                      return (
                        <ListBoxItem
                          key={`${queueName}:${job.id}`}
                          // Encoded, so the key makes a plain DOM id: react-aria
                          // builds element ids from it.
                          id={`${JOB_KEY}${[queueName, status ?? "", job.id]
                            .map(encodeURIComponent)
                            .join(":")}`}
                          textValue={`${label} ${queueDisplayName}`}
                          className={ITEM_CLASS}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={clsx(
                                "flex size-4 shrink-0 items-center justify-center",
                                (listStatus && STATUS_ICON_TONES[listStatus]) ??
                                  TEXT_FAINT,
                              )}
                              title={
                                listStatus
                                  ? STATUS_LABELS[listStatus]
                                  : undefined
                              }
                            >
                              {Icon ? <Icon className="size-3.5" /> : null}
                            </span>
                            <span className="truncate font-mono text-[13px]">
                              {label}
                            </span>
                            {job.name?.trim() ? (
                              <span
                                className={clsx(
                                  "shrink-0 font-mono text-[11px]",
                                  TEXT_FAINT,
                                )}
                              >
                                #{formatJobId(job.id)}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={clsx(
                              "shrink-0 truncate text-xs",
                              TEXT_MUTED,
                            )}
                          >
                            {queueDisplayName}
                          </span>
                        </ListBoxItem>
                      );
                    },
                  )}
                  {isFinding && !foundJobs?.length ? (
                    <ListBoxItem
                      id={`${JOB_KEY}searching`}
                      textValue="Searching jobs"
                      isDisabled
                      className={clsx(OVERLAY_ITEM, "gap-2.5", TEXT_MUTED)}
                    >
                      <Loader2
                        aria-hidden="true"
                        className="size-3.5 animate-spin"
                      />
                      Searching every queue…
                    </ListBoxItem>
                  ) : null}
                </ListBoxSection>
              ) : null}

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
                  <Item
                    id="view:errors"
                    label="Errors"
                    icon={<AlertTriangle className="size-3.5" />}
                  />
                  {currentQueue.supports.jobNames ? (
                    <Item
                      id="view:types"
                      label="Job types"
                      icon={<Shapes className="size-3.5" />}
                    />
                  ) : null}
                  {currentQueue.supports.schedulers ? (
                    <Item
                      id="view:schedulers"
                      label="Schedulers"
                      icon={<Calendar className="size-3.5" />}
                    />
                  ) : null}
                  <Item
                    id="action:pin"
                    label={
                      preferences.pinnedQueues.includes(currentQueue.name)
                        ? "Unpin this queue"
                        : "Pin this queue"
                    }
                    icon={<Star className="size-3.5" />}
                  />
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
