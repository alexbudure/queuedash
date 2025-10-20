import { Cross2Icon } from "@radix-ui/react-icons";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogTrigger, Heading, Modal } from "react-aria-components";
import { JSONEditor } from "./JSONEditor";

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
  variant?: "job" | "scheduler";
};

export const AddJobModal = ({
  queue,
  onDismiss,
  variant = "job",
}: JobModalProps) => {
  const { mutate: addJob, status: addJobStatus } =
    trpc.queue.addJob.useMutation({
      onSuccess() {
        toast.success("New job has been added");
        onDismiss();
      },
      onError(e) {
        toast.error(e.message);
      },
    });

  const { mutate: addJobScheduler, status: addSchedulerStatus } =
    trpc.queue.addJobScheduler.useMutation({
      onSuccess() {
        toast.success("New job scheduler has been added");
        onDismiss();
      },
      onError(e) {
        toast.error(e.message);
      },
    });

  const [value, setValue] = useState("{}");
  const [templateValue, setTemplateValue] = useState(
    JSON.stringify(
      {
        name: "",
        data: {},
        opts: {},
      },
      null,
      2,
    ),
  );
  const [optsValue, setOptsValue] = useState(
    JSON.stringify(
      {
        pattern: "0 0 * * *",
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      null,
      2,
    ),
  );

  const isJob = variant === "job";
  const status = isJob ? addJobStatus : addSchedulerStatus;

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
                  close();
                  onDismiss();
                }}
              >
                <Cross2Icon />
              </button>

              <div className="flex items-center space-x-4">
                <Heading className="mb-1 text-xl font-semibold text-slate-900">
                  Add {isJob ? "job" : "scheduler"} to{" "}
                  {queue.displayName.toLocaleLowerCase()}
                </Heading>
              </div>

              {isJob ? (
                <JSONEditor value={value} onChange={setValue} />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase text-slate-600">
                      Template
                    </label>
                    <JSONEditor
                      value={templateValue}
                      onChange={setTemplateValue}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase text-slate-600">
                      Options
                    </label>
                    <JSONEditor value={optsValue} onChange={setOptsValue} />
                  </div>
                </div>
              )}

              <div>
                <Button
                  label={isJob ? "Add job" : "Add scheduler"}
                  variant="filled"
                  disabled={status === "pending"}
                  onClick={() => {
                    try {
                      if (isJob) {
                        const data = JSON.parse(value);
                        addJob({
                          queueName: queue.name,
                          data,
                        });
                      } else {
                        const template = JSON.parse(templateValue);
                        const opts = JSON.parse(optsValue);
                        addJobScheduler({
                          queueName: queue.name,
                          template,
                          opts,
                        });
                      }
                    } catch {
                      toast.error("Invalid JSON");
                    }
                  }}
                />
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
};
