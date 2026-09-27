import {
  cloneElement,
  type PropsWithChildren,
  type ReactElement,
  useId,
} from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { FOCUS_RING, Z_INDEX } from "../utils/styles";
import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";

type AlertProps = {
  title: string;
  description: string;
  action: ReactElement<{
    disabled?: boolean;
    isLoading?: boolean;
    onClick?: () => void;
    size?: "sm" | "md" | "lg";
  }>;
  isPending?: boolean;
  /**
   * Controlled mode. An alert armed from a `MenuItem` cannot use the trigger:
   * react-aria closes the Menu as the item fires, which would unmount a nested
   * DialogTrigger before it could open. Those callers own the open state and
   * pass it here instead of a child trigger.
   */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};
export const Alert = ({
  title,
  description,
  action,
  isPending = false,
  isOpen,
  onOpenChange,
  children,
}: PropsWithChildren<AlertProps>) => {
  const { portalContainer } = useQueuedash();
  const descriptionId = useId();
  const isControlled = isOpen !== undefined;

  const overlay = (
    /* The scrim must be its own element: a standalone Modal puts the
       className on the inner div, so interact-outside never fires and the
       backdrop cannot dismiss. */
    <ModalOverlay
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      {...(isControlled ? { isOpen, onOpenChange } : {})}
      isDismissable
      style={{ zIndex: Z_INDEX.dialog }}
      className="alert-overlay fixed inset-0 flex items-center justify-center bg-black/[0.08] p-4 backdrop-blur-[2px] dark:bg-black/65"
    >
      <Modal className="alert-dialog max-h-[calc(100vh-2rem)] w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-transparent dark:bg-slate-800 dark:ring-1 dark:shadow-black/60 dark:ring-white/10">
        <Dialog
          role="alertdialog"
          aria-describedby={descriptionId}
          className="qd-scroll qd-scroll-contain max-h-[calc(100vh-2rem)] overflow-y-auto p-5 outline-none"
        >
          {({ close }) => {
            const originalOnClick = action.props.onClick;
            const actionWithClose = cloneElement(action, {
              disabled: isPending,
              isLoading: isPending,
              // A confirmation is the heaviest commit in the app; both of its
              // buttons take the large size regardless of what the caller sent.
              size: "lg",
              onClick: () => {
                if (isPending) return;
                originalOnClick?.();
                // Controlled callers keep the dialog up until their mutation
                // settles, so the confirm button can show it is in flight.
                if (!isControlled) close();
              },
            });

            return (
              <>
                <Heading
                  slot="title"
                  level={2}
                  className="mb-2 text-base font-semibold text-gray-900 dark:text-slate-100"
                >
                  {title}
                </Heading>
                <p
                  id={descriptionId}
                  className="mb-6 text-sm leading-6 text-gray-600 dark:text-slate-400"
                >
                  {description}
                </p>
                {/* Cancel is first in the DOM so the safe action takes
                    Dialog's initial focus. */}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={close} label="Cancel" size="lg" />
                  {actionWithClose}
                </div>
              </>
            );
          }}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  if (isControlled) return overlay;

  return (
    <DialogTrigger>
      <AriaButton
        isDisabled={isPending}
        // No opacity here: the inner Button already renders its own disabled
        // appearance, and stacking the two dimmed the trigger to 25%.
        className={`rounded-full disabled:cursor-not-allowed ${FOCUS_RING}`}
      >
        {children}
      </AriaButton>
      {overlay}
    </DialogTrigger>
  );
};
