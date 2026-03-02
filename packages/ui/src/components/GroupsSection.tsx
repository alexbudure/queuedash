import { Search, X, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { trpc } from "../utils/trpc";
import { Skeleton } from "./Skeleton";
import { REFETCH_INTERVAL } from "../utils/config";
import { Alert } from "./Alert";
import { Button } from "./Button";

type GroupsSectionProps = {
  queueName: string;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
};

export const GroupsSection = ({
  queueName,
  selectedGroupId,
  onSelectGroup,
}: GroupsSectionProps) => {
  const { data: groups, isLoading } = trpc.queue.groups.useQuery(
    { queueName },
    {
      enabled: !!queueName,
      refetchInterval: REFETCH_INTERVAL,
    },
  );

  const { mutate: bulkRemove, isPending: isDeleting } =
    trpc.job.bulkRemoveByGroup.useMutation();

  if (isLoading && !selectedGroupId) {
    return (
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
          Groups
        </h2>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if ((!groups || groups.length === 0) && !selectedGroupId) {
    return null;
  }

  const selectedGroup = groups?.find((g) => g.id === selectedGroupId);
  const selectedCount = selectedGroup?.count;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
        Groups
      </h2>

      {/* Selected group banner */}
      {selectedGroupId && (
        <div className="flex items-center justify-between rounded-lg bg-purple-50/80 px-3 py-2 dark:bg-purple-950/30">
          <div className="flex items-center gap-2">
            <Search className="size-3.5 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-purple-900 dark:text-purple-100">
              Filtering by group:{" "}
              <span className="font-mono">{selectedGroupId}</span>
            </span>
            {selectedCount !== undefined ? (
              <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400">
                ({selectedCount} job{selectedCount !== 1 ? "s" : ""})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedGroupId ? (
              <Alert
                title="Delete all jobs in this group?"
                description={`This action cannot be undone. This will permanently remove all jobs from group "${selectedGroupId}".`}
                action={
                  <Button
                    variant="filled"
                    colorScheme="red"
                    label="Yes, delete all"
                    onClick={() =>
                      bulkRemove({ queueName, groupId: selectedGroupId })
                    }
                  />
                }
              >
                <Button
                  as="span"
                  colorScheme="red"
                  icon={<Trash2 className="size-3" />}
                  label={isDeleting ? "Deleting..." : "Delete all"}
                  size="sm"
                  isLoading={isDeleting}
                />
              </Alert>
            ) : null}
            <button
              onClick={() => onSelectGroup(null)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/50"
            >
              <X className="size-3" />
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Group cards */}
      {groups && groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((group) => {
            const isSelected = selectedGroupId === group.id;
            return (
              <button
                key={group.id}
                onClick={() => onSelectGroup(isSelected ? null : group.id)}
                className={clsx(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors",
                  isSelected
                    ? "bg-purple-50/60 dark:bg-purple-950/30"
                    : "hover:bg-gray-100/60 dark:hover:bg-slate-800/50",
                )}
              >
                <span className="min-w-0 truncate font-mono text-sm text-gray-900 dark:text-white">
                  {group.id}
                </span>
                <span className="ml-2 shrink-0 font-mono text-xs text-gray-400 dark:text-slate-500">
                  {group.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
