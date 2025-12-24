import {
  MagnifyingGlassIcon,
  Cross2Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { trpc } from "../utils/trpc";
import { Skeleton } from "./Skeleton";
import { REFETCH_INTERVAL } from "../utils/config";
import { Alert } from "./Alert";
import { Button } from "./Button";

type GroupsSectionProps = {
  queueName: string;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  /** Job IDs currently visible (for bulk delete) */
  visibleJobIds?: string[];
};

export const GroupsSection = ({
  queueName,
  selectedGroupId,
  onSelectGroup,
  visibleJobIds = [],
}: GroupsSectionProps) => {
  const { data: groups, isLoading } = trpc.queue.groups.useQuery(
    { queueName },
    {
      enabled: !!queueName,
      refetchInterval: REFETCH_INTERVAL,
    },
  );

  const { mutate: bulkRemove, isPending: isDeleting } =
    trpc.job.bulkRemove.useMutation();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Groups
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return null;
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Groups
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Click to filter jobs
        </span>
      </div>

      {/* Selected group banner */}
      {selectedGroupId && selectedGroup && (
        <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 dark:border-purple-800/50 dark:bg-purple-950/30">
          <div className="flex items-center gap-3">
            <MagnifyingGlassIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="text-sm font-medium text-purple-900 dark:text-purple-100">
              Filtering by group:{" "}
              <span className="font-mono">{selectedGroupId}</span>
            </span>
            <span className="text-xs text-purple-600 dark:text-purple-400">
              ({visibleJobIds.length} job{visibleJobIds.length !== 1 ? "s" : ""}{" "}
              shown)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {visibleJobIds.length > 0 && (
              <Alert
                title="Delete all jobs in this group?"
                description={`This action cannot be undone. This will permanently remove ${visibleJobIds.length} job${visibleJobIds.length !== 1 ? "s" : ""} from this group.`}
                action={
                  <Button
                    variant="filled"
                    colorScheme="red"
                    label="Yes, delete all"
                    onClick={() => bulkRemove({ queueName, jobIds: visibleJobIds })}
                  />
                }
              >
                <Button
                  colorScheme="red"
                  icon={<TrashIcon className="h-3 w-3" />}
                  label={isDeleting ? "Deleting..." : "Delete all"}
                  size="sm"
                  isLoading={isDeleting}
                />
              </Alert>
            )}
            <button
              onClick={() => onSelectGroup(null)}
              className="flex items-center gap-1 rounded-md bg-purple-100 px-2.5 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900"
            >
              <Cross2Icon className="h-3 w-3" />
              Clear filter
            </button>
          </div>
        </div>
      )}

      {/* Group cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() =>
              onSelectGroup(selectedGroupId === group.id ? null : group.id)
            }
            className={`group flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
              selectedGroupId === group.id
                ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500 dark:border-purple-400 dark:bg-purple-950/30"
                : "border-slate-200 bg-white hover:border-purple-300 hover:bg-purple-50/50 dark:border-slate-700/50 dark:bg-slate-900/50 dark:hover:border-purple-700 dark:hover:bg-purple-950/20"
            }`}
          >
            <div className="mb-1 flex w-full items-center justify-between">
              <span className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                {group.id}
              </span>
              <MagnifyingGlassIcon
                className={`h-3.5 w-3.5 transition ${
                  selectedGroupId === group.id
                    ? "text-purple-500"
                    : "text-slate-400 opacity-0 group-hover:opacity-100 dark:text-slate-500"
                }`}
              />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {group.count} job{group.count !== 1 ? "s" : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
