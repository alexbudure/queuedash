import { toast } from "sonner";

/**
 * Ten of the fifteen mutations in the dashboard used to report nothing at all -
 * including `empty`, which purges a whole queue, and `pauseAll`, which stops
 * every worker in the deployment. `cleanQueue` had an `onSuccess` and no
 * `onError`, so a failed purge looked exactly like a successful one.
 *
 * Sonner's Toaster is already a polite live region, so routing every mutation
 * through here also closes the assistive-technology gap.
 *
 * Usage:
 *   const pause = trpc.queue.pause.useMutation(mutationToasts("Queue paused"));
 *
 *   const remove = trpc.job.remove.useMutation(
 *     mutationToasts("Job removed", { onSuccess: () => onDismiss() }),
 *   );
 */
export const mutationToasts = <TData = unknown>(
  successMessage: string,
  options?: {
    /** Defaults to a lower-cased "<successMessage> failed". */
    errorMessage?: string;
    onSuccess?: (data: TData) => void;
    onError?: (error: { message?: string }) => void;
    /** Pass false to run side effects without announcing success. */
    showSuccessToast?: boolean;
  },
) => ({
  onSuccess: (data: TData) => {
    if (options?.showSuccessToast !== false) toast.success(successMessage);
    options?.onSuccess?.(data);
  },
  onError: (error: { message?: string }) => {
    toast.error(
      error?.message ||
        options?.errorMessage ||
        `${successMessage} failed. Please try again.`,
    );
    options?.onError?.(error);
  },
});

/**
 * Reports the outcome of a bulk operation honestly - "48 retried, 2 failed"
 * rather than a bare success, which is what the per-job loop used to imply
 * even when half the jobs errored.
 */
export const bulkResultToast = (
  verbPastTense: string,
  noun: string,
  result:
    | { succeeded?: number; failed?: number; partial?: boolean }
    | undefined,
) => {
  const succeeded = result?.succeeded ?? 0;
  const failed = result?.failed ?? 0;
  const nounLabel = (count: number) => (count === 1 ? noun : `${noun}s`);
  // Filter-scoped bulk actions only reach as far as the server's scan limit.
  const more = result?.partial ? "; more may match" : "";

  if (failed > 0 && succeeded > 0) {
    toast.warning(
      `${succeeded} ${nounLabel(succeeded)} ${verbPastTense}, ${failed} failed${more}`,
    );
    return;
  }

  if (failed > 0) {
    toast.error(
      `Could not ${verbPastTense.replace(/ed$/, "")} ${failed} ${nounLabel(failed)}`,
    );
    return;
  }

  toast.success(`${succeeded} ${nounLabel(succeeded)} ${verbPastTense}${more}`);
};
