import { CounterClockwiseClockIcon, Cross2Icon } from "@radix-ui/react-icons";
import type { Job } from "../utils/trpc";
import { JSONTree } from "react-json-tree";
import { JobActionMenu } from "./JobActionMenu";
import { Button } from "./Button";
import { trpc } from "../utils/trpc";
import { Dialog, Heading, Modal } from "react-aria-components";

type JobModalProps = {
  job: Job;
  onDismiss: () => void;
  queueName: string;
};

export const JobModal = ({ job, queueName, onDismiss }: JobModalProps) => {
  const queueReq = trpc.queue.byName.useQuery({
    queueName,
  });

  const { mutate: retry } = trpc.job.retry.useMutation();
  const { data } = trpc.job.logs.useQuery({
    jobId: job.id,
    queueName,
  });

  return (
    <Modal
      isOpen={true}
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      className="fixed inset-0 bg-black/20 dark:bg-black/40"
    >
      <Dialog className="fixed left-1/2 top-1/2 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-scroll rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
        {({ close }) => (
          <>
            <button
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-slate-500 transition duration-150 ease-in-out hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Close"
              onClick={() => {
                onDismiss();
                close();
              }}
            >
              <Cross2Icon />
            </button>

            <div className="flex items-center space-x-4">
              <Heading className="mb-1 flex items-center space-x-2">
                <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {job.name}
                </span>

                <span className="rounded-md text-slate-500 dark:text-slate-400">#{job.id}</span>
              </Heading>
              <JobActionMenu
                queueName={queueName}
                job={job}
                queue={queueReq.data ?? undefined}
                onRemove={onDismiss}
              />
            </div>

            <div>
              {job.failedReason ? (
                <div className="space-y-2 border-b border-b-slate-200 py-4 dark:border-b-slate-700">
                  <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Error
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">{job.failedReason}</p>
                  {/*TODO: Add stacktrace */}
                  <Button
                    label="Retry"
                    size="sm"
                    icon={<CounterClockwiseClockIcon width={14} />}
                    onClick={() => {
                      retry({
                        queueName,
                        jobId: job.id,
                      });
                      onDismiss();
                    }}
                  />
                </div>
              ) : null}

              <div className="space-y-2 border-b border-b-slate-200 py-4 dark:border-b-slate-700">
                <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                  Options
                </p>
                <div className="data-json-renderer [&>ul]:max-h-[400px]">
                  <JSONTree data={job.opts} theme="monokai" />
                </div>
              </div>

              <div className="space-y-2 py-4">
                <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                  Data
                </p>
                <div className="data-json-renderer [&>ul]:max-h-[400px]">
                  <JSONTree data={job.data} theme="monokai" />
                </div>
              </div>

              {job.returnValue && (
                <div className="space-y-2 py-4 border-t border-t-slate-200 dark:border-b-slate-700">
                  <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Return value
                  </p>
                  <div className="data-json-renderer [&>ul]:max-h-[400px]">
                    <JSONTree data={job.returnValue} theme="monokai" />
                  </div>
                </div>
              )}

              {queueReq.data?.supports.logs && data?.length ? (
                <div className="space-y-2 border-t border-t-slate-200 pt-4 dark:border-t-slate-700">
                  <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Logs
                  </p>
                  <div className="space-y-1">
                    {data?.map((log, index) => {
                      return (
                        <div
                          key={index}
                          className="flex items-center space-x-2"
                        >
                          <div className="h-4 w-1 rounded-sm bg-slate-300 dark:bg-slate-600" />
                          <p className="font-mono text-sm text-slate-900 dark:text-slate-100">{log}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Dialog>
    </Modal>
  );
};
