import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { PropsWithChildren, ReactElement } from "react";
import { Button } from "./Button";

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
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/10" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-scroll rounded-lg bg-white p-4 shadow-xl">
          <AlertDialog.Title className="mb-3 text-xl font-semibold text-slate-900">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mb-6 text-slate-600">
            {description}
          </AlertDialog.Description>
          <div className="flex justify-end space-x-3">
            <AlertDialog.Cancel asChild>
              <Button label="Cancel" />
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>{action}</AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};
