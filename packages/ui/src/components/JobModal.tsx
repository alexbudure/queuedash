import { CounterClockwiseClockIcon, Cross2Icon } from "@radix-ui/react-icons";
import type { Job } from "../utils/trpc";
import { JSONTree } from "react-json-tree";
import { JobActionMenu } from "./JobActionMenu";
import { Button } from "./Button";
import { trpc } from "../utils/trpc";
import { Dialog, DialogTrigger, Heading, Modal } from "react-aria-components";

type JobModalProps = {
  job: Job;
  onDismiss: () => void;
  queueName: string;
};

export const JobModal = ({ job, queueName, onDismiss }: JobModalProps) => {
  const { mutate: retry } = trpc.job.retry.useMutation();

  return (
    <DialogTrigger
      isOpen={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
    >
      <Modal isDismissable className="fixed inset-0 bg-black/10">
        <Dialog className="fixed left-1/2 top-1/2 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-scroll rounded-lg bg-white p-4 shadow-xl">
          {({ close }) => (
            <>
              <button
                className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-slate-500 transition duration-150 ease-in-out hover:bg-slate-50"
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
                  <span className="text-xl font-semibold text-slate-900">
                    {job.name}
                  </span>

                  <span className="rounded-md text-slate-500">#{job.id}</span>
                </Heading>
                <JobActionMenu
                  queueName={queueName}
                  job={job}
                  onRemove={onDismiss}
                />
              </div>

              <div>
                {job.failedReason ? (
                  <div className="space-y-2 border-b border-b-slate-200 py-4">
                    <p className="text-xs font-semibold uppercase text-slate-600">
                      Error
                    </p>
                    <p className="text-sm text-red-600">{job.failedReason}</p>
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

                <div className="space-y-2 border-b border-b-slate-200 py-4">
                  <p className="text-xs font-semibold uppercase text-slate-600">
                    Options
                  </p>
                  <div className="data-json-renderer [&>ul]:max-h-[400px]">
                    <JSONTree data={job.opts} theme="monokai" />
                  </div>
                </div>

                <div className="space-y-2 pt-4">
                  <p className="text-xs font-semibold uppercase text-slate-600">
                    Data
                  </p>
                  <div className="data-json-renderer [&>ul]:max-h-[400px]">
                    <JSONTree data={job.data} theme="monokai" />
                  </div>
                </div>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
};
