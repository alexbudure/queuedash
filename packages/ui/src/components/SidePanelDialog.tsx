import { clsx } from "clsx";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { FOCUS_RING_DATA } from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";

type SidePanelDialogProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  titleClassName?: string;
  headerActions?: ReactNode;
  children: ReactNode;
  /** Pinned below the scroll area, so a primary action is never scrolled away. */
  footer?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelClassName?: string;
  /** Both are needed to protect unsaved work: `isDismissable={false}` alone
   *  still lets Escape close the panel. */
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
  /** Called when the close button is pressed while dismissal is blocked. */
  onCloseAttempt?: () => void;
};

export const SidePanelDialog = ({
  title,
  subtitle,
  titleClassName,
  headerActions,
  children,
  footer,
  open,
  onOpenChange,
  panelClassName,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  onCloseAttempt,
}: SidePanelDialogProps) => {
  const { portalContainer } = useQueuedash();
  // The X has to obey the same guard as Escape and the scrim. `isDismissable`
  // and `isKeyboardDismissDisabled` only reach ModalOverlay, which governs
  // outside-press and Escape - so without this the header button was a
  // one-click discard for work the other two paths were protecting.
  const canDismiss = isDismissable && !isKeyboardDismissDisabled;
  const handleClose = () => {
    if (canDismiss) onOpenChange(false);
    else onCloseAttempt?.();
  };

  return (
    <ModalOverlay
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      // The scrim was 42% in dark where Alert's is 65%. `.side-panel-overlay`
      // in global.css outranks a plain utility, so matching it has to be forced.
      className="side-panel-overlay fixed inset-0 z-50 flex items-center justify-end dark:bg-black/65!"
    >
      <div className="flex size-full items-center justify-end">
        <Modal
          className={clsx(
            // OVERLAY_SURFACE's material, adapted to a full-height panel: in
            // dark the old `border-slate-800` on a near-black scrim left no
            // visible edge, so the hairline is the same light one popovers use.
            "side-panel relative size-full max-w-[680px] border-l border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900 dark:shadow-black/60",
            panelClassName,
          )}
        >
          <Dialog className="flex h-full flex-col overflow-hidden outline-none">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1 pr-3">
                <Heading
                  slot="title"
                  title={typeof title === "string" ? title : undefined}
                  className={clsx(
                    "truncate text-base font-semibold text-gray-900 dark:text-white",
                    titleClassName,
                  )}
                >
                  {title}
                </Heading>
                {subtitle ? (
                  <div
                    title={typeof subtitle === "string" ? subtitle : undefined}
                    className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-400 dark:text-slate-500"
                  >
                    {typeof subtitle === "string" ? (
                      <span className="truncate">{subtitle}</span>
                    ) : (
                      subtitle
                    )}
                  </div>
                ) : null}
              </div>

              {headerActions ? (
                <div className="flex shrink-0 items-center gap-2">
                  {headerActions}
                </div>
              ) : null}

              <AriaButton
                onPress={handleClose}
                className={clsx(
                  "ml-2 rounded-full p-1.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 dark:active:bg-slate-700",
                  FOCUS_RING_DATA,
                )}
                aria-label="Close panel"
              >
                <X className="size-4" />
              </AriaButton>
            </div>

            <div className="qd-scroll qd-scroll-contain min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>

            {footer ? <div className="shrink-0">{footer}</div> : null}
          </Dialog>
        </Modal>
      </div>
    </ModalOverlay>
  );
};
