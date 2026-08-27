import { cloneElement, type PropsWithChildren, type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
} from "react-aria-components";

import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";

type AlertProps = {
  title: string;
  description: string;
  action: ReactElement<{
    disabled?: boolean;
    isLoading?: boolean;
    onClick?: () => void;
  }>;
  isPending?: boolean;
};
export const Alert = ({
  title,
  description,
  action,
  isPending = false,
  children,
}: PropsWithChildren<AlertProps>) => {
  const { portalContainer } = useQueuedash();

  return (
    <DialogTrigger>
      <AriaButton
        isDisabled={isPending}
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-900"
      >
        {children}
      </AriaButton>
      <Modal
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        isDismissable
        className="fixed inset-0 z-[90] bg-black/20 dark:bg-black/40"
      >
        <Dialog
          role="alertdialog"
          className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl outline-none dark:bg-slate-900"
        >
          {({ close }) => {
            const originalOnClick = action.props.onClick;
            const actionWithClose = cloneElement(action, {
              disabled: isPending,
              isLoading: isPending,
              onClick: () => {
                if (isPending) return;
                originalOnClick?.();
                close();
              },
            });

            return (
              <>
                <Heading className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {title}
                </Heading>
                <p className="mb-6 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {description}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={close} label="Cancel" />
                  {actionWithClose}
                </div>
              </>
            );
          }}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
};
