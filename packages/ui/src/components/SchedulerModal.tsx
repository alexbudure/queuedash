import { Cross2Icon } from "@radix-ui/react-icons";
import type { Scheduler } from "../utils/trpc";
import { JSONTree } from "react-json-tree";
import { Dialog, Heading, Modal } from "react-aria-components";
import { SchedulerActionMenu } from "./SchedulerActionMenu";

type SchedulerModalProps = {
  scheduler: Scheduler;
  queueName: string;
  onDismiss: () => void;
};

export const SchedulerModal = ({
  scheduler,
  queueName,
  onDismiss,
}: SchedulerModalProps) => {
  const template = scheduler.template;
  const opts = {
    ...scheduler,
  };
  delete opts.template;

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
                  {scheduler.name}
                </span>

                <span className="rounded-md text-slate-500 dark:text-slate-400">
                  #{scheduler.id}
                </span>
              </Heading>
              <SchedulerActionMenu
                queueName={queueName}
                scheduler={scheduler}
                onRemove={onDismiss}
              />
            </div>

            <div>
              <div className="space-y-2 border-b border-b-slate-200 py-4 dark:border-b-slate-700">
                <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                  Options
                </p>
                <div className="data-json-renderer [&>ul]:max-h-[400px]">
                  <JSONTree data={opts} theme="monokai" />
                </div>
              </div>
              <div className="space-y-2 pt-4">
                <p className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                  Template
                </p>
                <div className="data-json-renderer [&>ul]:max-h-[400px]">
                  <JSONTree data={template} theme="monokai" />
                </div>
              </div>
            </div>
          </>
        )}
      </Dialog>
    </Modal>
  );
};
