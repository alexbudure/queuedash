import { clsx } from "clsx";
import { ArrowUpDown, Loader2, Search, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { DateRange } from "../utils/dateRange";
import {
  FOCUS_FIELD,
  FOCUS_RING,
  INPUT_CLASS,
  TEXT_FAINT,
} from "../utils/styles";
import type { Status } from "../utils/trpc";
import { PHONE_MEDIA_QUERY, useMediaQuery } from "../utils/useMediaQuery";
import { getStatusDisplayName, type JobSort } from "../utils/viewState";
import { type DateRangeCountInput, DateRangeFilter } from "./DateRangeFilter";
import { ErrorFilterChip } from "./ErrorGroups";
import { Select, type SelectOption } from "./Select";

const SORT_OPTIONS: ReadonlyArray<SelectOption<JobSort>> = [
  { label: "Queue order", value: "queue" },
  { label: "Newest created", value: "newest" },
  { label: "Oldest created", value: "oldest" },
];

type JobSearchProps = {
  status: Status;
  query: string;
  sort: JobSort;
  dateRange: DateRange;
  isLoading?: boolean;
  // Set while the list shows one error group from the Errors tab.
  errorFilter?: { label: string; onClear: () => void };
  // Set while the list shows one job name from the Job types tab.
  nameFilter?: { label: string; onClear: () => void };
  /** The list the date filter's phone sheet counts against. */
  countInput: DateRangeCountInput;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: JobSort) => void;
  onDateRangeChange: (range: DateRange) => void;
};

export const JobSearch = ({
  status,
  query,
  sort,
  dateRange,
  isLoading = false,
  errorFilter,
  nameFilter,
  countInput,
  onQueryChange,
  onSortChange,
  onDateRangeChange,
}: JobSearchProps) => {
  const [draft, setDraft] = useState(query);
  // The full hint is cut mid-word on a phone, where the field shares its row
  // with two icon buttons.
  const isPhone = useMediaQuery(PHONE_MEDIA_QUERY);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const clear = () => {
    setDraft("");
    onQueryChange("");
  };

  const isDirty = draft.trim() !== query;
  // Reserve exactly the trailing cluster that is actually rendered, so a clean
  // field uses its full width instead of holding a gap for absent controls.
  const trailingPadding = isDirty
    ? draft
      ? "pr-[5.75rem]"
      : "pr-16"
    : draft
      ? "pr-10"
      : "pr-3";

  return (
    <div>
      <div
        className={clsx(
          "flex flex-wrap gap-2 sm:flex-nowrap",
          errorFilter || nameFilter ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        {nameFilter ? (
          <span className="inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-gray-100 pr-1 pl-2.5 text-gray-800 ring-1 ring-gray-200 ring-inset max-sm:basis-full sm:max-w-[35%] dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
            <Tag
              aria-hidden="true"
              className="size-3.5 shrink-0 text-gray-500 dark:text-slate-400"
            />
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs"
              title={nameFilter.label}
            >
              {nameFilter.label}
            </span>
            <button
              type="button"
              onClick={nameFilter.onClear}
              aria-label="Stop filtering by this job name"
              className={clsx(
                "grid size-6 shrink-0 place-items-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white",
                FOCUS_RING,
              )}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        ) : null}
        {errorFilter ? (
          // Its own row on a phone; on wider screens the wrapper steps aside so
          // the chip's width cap is measured against the whole row.
          <div className="flex min-w-0 basis-full sm:contents">
            <ErrorFilterChip
              label={errorFilter.label}
              onClear={errorFilter.onClear}
            />
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onQueryChange(draft.trim().slice(0, 200));
          }}
          className="relative min-w-0 flex-1"
        >
          <Search
            aria-hidden="true"
            className={clsx(
              "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 max-sm:size-[18px]",
              TEXT_FAINT,
            )}
          />
          <input
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Filter jobs"
            placeholder={
              isPhone
                ? `Filter ${getStatusDisplayName(status)} jobs`
                : "Filter this status by ID, name, group, or visible data"
            }
            className={clsx(
              INPUT_CLASS,
              FOCUS_FIELD,
              // 16px on a phone: iOS zooms into any smaller field on focus.
              "pl-9 max-sm:h-11 max-sm:rounded-[10px] max-sm:pl-10 max-sm:text-base",
              trailingPadding,
            )}
          />
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
            {draft ? (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear job filter"
                className={clsx(
                  "flex size-6 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:active:bg-slate-700",
                  FOCUS_RING,
                )}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
            {isDirty || isLoading ? (
              <button
                type="submit"
                disabled={isLoading}
                aria-label={isLoading ? "Applying job filter" : undefined}
                className={clsx(
                  "relative h-6 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-brand-700 active:bg-brand-800 disabled:cursor-progress dark:hover:bg-brand-500 dark:active:bg-brand-700",
                  FOCUS_RING,
                )}
              >
                {/* The spinner is layered over the label so the button - and the
                  cluster the input reserves space for - keeps its width. */}
                <span className={clsx(isLoading && "invisible")}>Apply</span>
                {isLoading ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Loader2
                      aria-hidden="true"
                      className="size-3.5 animate-spin"
                    />
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        </form>

        <DateRangeFilter
          status={status}
          range={dateRange}
          onChange={onDateRangeChange}
          countInput={countInput}
        />

        <Select<JobSort>
          ariaLabel="Sort jobs"
          size="lg"
          className="shrink-0"
          isDisabled={isLoading}
          onChange={onSortChange}
          options={SORT_OPTIONS}
          value={sort}
          phoneIcon={<ArrowUpDown className="size-[18px]" />}
        />
      </div>
    </div>
  );
};
