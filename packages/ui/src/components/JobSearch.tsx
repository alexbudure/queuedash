import { clsx } from "clsx";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  FOCUS_FIELD,
  FOCUS_RING,
  INPUT_CLASS,
  TEXT_FAINT,
} from "../utils/styles";
import type { JobSort } from "../utils/viewState";
import { Select, type SelectOption } from "./Select";

const SORT_OPTIONS: ReadonlyArray<SelectOption<JobSort>> = [
  { label: "Queue order", value: "queue" },
  { label: "Newest created", value: "newest" },
  { label: "Oldest created", value: "oldest" },
];

type JobSearchProps = {
  query: string;
  sort: JobSort;
  isLoading?: boolean;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: JobSort) => void;
};

export const JobSearch = ({
  query,
  sort,
  isLoading = false,
  onQueryChange,
  onSortChange,
}: JobSearchProps) => {
  const [draft, setDraft] = useState(query);

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
      <div className="flex max-w-2xl flex-col gap-2 sm:flex-row">
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
              "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2",
              TEXT_FAINT,
            )}
          />
          <input
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Filter jobs"
            placeholder="Filter this status by ID, name, group, or visible data"
            className={clsx(INPUT_CLASS, FOCUS_FIELD, "pl-9", trailingPadding)}
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

        <Select<JobSort>
          ariaLabel="Sort jobs"
          size="lg"
          className="shrink-0"
          isDisabled={isLoading}
          onChange={onSortChange}
          options={SORT_OPTIONS}
          value={sort}
        />
      </div>
    </div>
  );
};
