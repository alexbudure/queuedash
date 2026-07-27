import { Loader2, Search, X } from "lucide-react";
import { useState } from "react";

import type { Job, JobSearchResult } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { JobModal } from "./JobModal";

export const JobSearch = ({ queueName }: { queueName: string }) => {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const searchReq = trpc.job.search.useQuery(
    {
      queueName,
      query,
      limit: 25,
      maxScanned: 500,
    },
    {
      enabled: query.length > 0,
      retry: false,
      staleTime: 30_000,
    },
  );

  const clear = () => {
    setDraft("");
    setQuery("");
  };

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
        className="relative max-w-xl"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Search jobs"
          placeholder="Search job ID, name, or visible data"
          className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-20 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-brand-600 dark:focus:ring-brand-950"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {draft ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear job search"
              className="flex size-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!draft.trim() || searchReq.isFetching}
            className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            {searchReq.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Search"
            )}
          </button>
        </div>
      </form>

      {query ? (
        <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {searchReq.isError ? (
            <div className="px-3 py-3 text-xs text-red-600 dark:text-red-400">
              Could not search jobs.
            </div>
          ) : searchReq.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500 dark:text-slate-400">
              <Loader2 className="size-3.5 animate-spin" />
              Searching a bounded set of recent jobs…
            </div>
          ) : searchReq.data?.results.length ? (
            <>
              <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-slate-800">
                {searchReq.data.results.map((result: JobSearchResult) => (
                  <button
                    type="button"
                    key={result.job.id}
                    onClick={() => setSelectedJob(result.job)}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition hover:bg-gray-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-medium text-gray-900 dark:text-white">
                        {result.job.name || `#${result.job.id}`}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-gray-400 dark:text-slate-500">
                        #{result.job.id}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-slate-800 dark:text-slate-400">
                      {result.status ?? "Exact ID"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-400 dark:border-slate-800 dark:text-slate-500">
                {searchReq.data.partial
                  ? `Showing partial results after scanning ${searchReq.data.scanned} jobs.`
                  : `Scanned ${searchReq.data.scanned} jobs.`}
              </div>
            </>
          ) : (
            <div className="px-3 py-3 text-xs text-gray-500 dark:text-slate-400">
              No matches in the {searchReq.data?.scanned ?? 0} jobs scanned.
            </div>
          )}
        </div>
      ) : null}

      {selectedJob ? (
        <JobModal
          job={selectedJob}
          queueName={queueName}
          onDismiss={() => setSelectedJob(null)}
        />
      ) : null}
    </div>
  );
};
