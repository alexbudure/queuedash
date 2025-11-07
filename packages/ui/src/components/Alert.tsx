import type { PropsWithChildren, ReactElement } from "react";
import { Button } from "./Button";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
} from "react-aria-components";

type AlertProps = {
  title: string;
  description: string;
  action: ReactElement;
};
export const Alert = ({
  title,
  description,
  action,
  children,
}: PropsWithChildren<AlertProps>) => {
  return (
    <DialogTrigger>
      <AriaButton>{children}</AriaButton>
      <Modal isDismissable className="fixed inset-0 bg-black/20 dark:bg-black/40">
        <Dialog
          role="alertdialog"
          className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-scroll rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900"
        >
          {({ close }) => (
            <>
              <Heading className="mb-3 text-xl font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </Heading>
              <p className="mb-6 text-slate-600 dark:text-slate-400">{description}</p>
              <div className="flex justify-end space-x-3">
                <Button onClick={close} label="Cancel" />
                {action}
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
};
