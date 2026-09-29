import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const MAX_NAMES = 6;

type ListPage = { jobs?: Array<{ rawName?: unknown }> };

/**
 * The names jobs in this queue were added under, most used first, from the job
 * lists already loaded for it: no request of its own. Read once, when the form
 * opens. Bull's unnamed jobs carry `__default__`, which is no name to offer.
 */
export const useRecentJobNames = (
  queueName: string,
  enabled: boolean,
): string[] => {
  const queryClient = useQueryClient();
  const [names] = useState(() => {
    if (!enabled) return [];
    const counts = new Map<string, number>();
    const cached = queryClient.getQueriesData<unknown>({
      queryKey: [["job", "list"]],
    });
    for (const [queryKey, data] of cached) {
      const input = (queryKey[1] as { input?: { queueName?: unknown } })?.input;
      if (input?.queueName !== queueName || !data) continue;
      const pages = (data as { pages?: ListPage[] }).pages ?? [
        data as ListPage,
      ];
      for (const page of pages) {
        for (const job of page?.jobs ?? []) {
          const name = job.rawName;
          if (typeof name !== "string" || !name || name === "__default__") {
            continue;
          }
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_NAMES)
      .map(([name]) => name);
  });
  return names;
};
