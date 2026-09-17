import { clsx } from "clsx";
import { Search, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatCount, formatCountLabel } from "../utils/format";
import { FOCUS_RING, SECTION_LABEL, TEXT_FAINT } from "../utils/styles";
import { trpc } from "../utils/trpc";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";
import { Skeleton } from "./Skeleton";

type GroupsSectionProps = {
  canRemoveJobs: boolean;
  queueName: string;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
};

export const GroupsSection = ({
  canRemoveJobs,
  queueName,
  selectedGroupId,
  onSelectGroup,
}: GroupsSectionProps) => {
  const { preferences } = useQueuedash();
  const { data: groups, isLoading } = trpc.queue.groups.useQuery(
    { queueName },
    {
      enabled: !!queueName,
      refetchInterval: preferences.refreshIntervalMs,
    },
  );

  const { mutate: bulkRemove, isPending: isDeleting } =
    trpc.job.bulkRemoveByGroup.useMutation({
      onSuccess(data) {
        toast.success(
          `Removed ${formatCountLabel(data.succeeded, "job")}${
            data.failed > 0 ? `, ${data.failed} failed` : ""
          }${data.partial ? "; more jobs may remain in this group" : ""}`,
        );
      },
      onError(error) {
        toast.error(error.message || "Failed to remove jobs from the group");
      },
    });

  if (isLoading && !selectedGroupId) {
    return (
      <div className="space-y-3">
        <h2 className={SECTION_LABEL}>Groups</h2>
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
      <h2 className={SECTION_LABEL}>Groups</h2>

      {/* Selected group banner */}
      {selectedGroupId && (
        <div className="flex items-center justify-between rounded-lg bg-purple-50/80 px-3 py-2 dark:bg-purple-950/30">
          <div className="flex min-w-0 items-center gap-2">
            <Search className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
            <span className="min-w-0 truncate text-xs font-medium text-purple-900 dark:text-purple-100">
              Filtering by group:{" "}
              <span className="font-mono" title={selectedGroupId}>
                {selectedGroupId}
              </span>
            </span>
            {selectedCount !== undefined ? (
              <span className="shrink-0 font-mono text-[10px] text-purple-600 dark:text-purple-400">
                ({formatCountLabel(selectedCount, "job")})
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {selectedGroupId && canRemoveJobs ? (
              <Alert
                isPending={isDeleting}
                title="Remove eligible jobs in this group?"
                description={`This action cannot be undone. It will permanently remove eligible jobs from group "${selectedGroupId}" found within the server scan limit.`}
                action={
                  <Button
                    variant="filled"
                    colorScheme="red"
                    label="Yes, remove eligible"
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
                  label="Remove eligible"
                  size="sm"
                  isLoading={isDeleting}
                />
              </Alert>
            ) : null}
            <button
              onClick={() => onSelectGroup(null)}
              className={clsx(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-purple-600 transition-colors duration-150 hover:bg-purple-100 active:bg-purple-200 dark:text-purple-400 dark:hover:bg-purple-900/50 dark:active:bg-purple-900",
                FOCUS_RING,
              )}
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
                aria-pressed={isSelected}
                onClick={() => onSelectGroup(isSelected ? null : group.id)}
                className={clsx(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors duration-150",
                  FOCUS_RING,
                  isSelected
                    ? "bg-purple-50/60 hover:bg-purple-100/70 active:bg-purple-100 dark:bg-purple-950/30 dark:hover:bg-purple-950/60 dark:active:bg-purple-900/40"
                    : "hover:bg-gray-100/60 active:bg-gray-200/60 dark:hover:bg-slate-800/50 dark:active:bg-slate-700/50",
                )}
              >
                <span
                  title={group.id}
                  className="min-w-0 truncate font-mono text-sm text-gray-900 dark:text-white"
                >
                  {group.id}
                </span>
                {/* Count only - the unit is already stated once in the banner,
                    and repeating "jobs" down the column steals width from the
                    truncated group id. */}
                <span
                  className={clsx(
                    "ml-2 shrink-0 font-mono text-xs",
                    TEXT_FAINT,
                  )}
                >
                  {formatCount(group.count)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
