import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { JobSort } from "../utils/viewState";

type JobSearchProps = {
  query: string;
  sort: JobSort;
  isLoading?: boolean;
  searchMeta?: {
    scanned: number;
    capped: boolean;
    scanLimit: number;
  };
  onQueryChange: (query: string) => void;
  onSortChange: (sort: JobSort) => void;
};

export const JobSearch = ({
  query,
  sort,
  isLoading = false,
  searchMeta,
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
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
          <input
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Filter jobs"
            placeholder="Filter this status by ID, name, group, or visible data"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pr-20 pl-9 text-sm text-gray-900 transition outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-brand-600 dark:focus:ring-brand-950"
          />
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
            {draft ? (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear job filter"
                className="flex size-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={isLoading || draft.trim() === query}
              aria-label={isLoading ? "Applying job filter" : undefined}
              className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Apply"
              )}
            </button>
          </div>
        </form>

        <select
          aria-label="Sort jobs"
          value={sort}
          disabled={isLoading}
          onChange={(event) => onSortChange(event.target.value as JobSort)}
          className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 transition outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:focus:border-brand-600 dark:focus:ring-brand-950"
        >
          <option value="queue">Queue order</option>
          <option value="newest">Newest created</option>
          <option value="oldest">Oldest created</option>
        </select>
      </div>

      {searchMeta ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-1.5 text-[10px] ${
            searchMeta.capped
              ? "text-amber-600 dark:text-amber-400"
              : "text-gray-400 dark:text-slate-500"
          }`}
        >
          {searchMeta.capped
            ? `Partial results: scanned the first ${searchMeta.scanned.toLocaleString()} jobs permitted by the server.`
            : `Scanned ${searchMeta.scanned.toLocaleString()} jobs.`}
        </p>
      ) : null}
    </div>
  );
};
