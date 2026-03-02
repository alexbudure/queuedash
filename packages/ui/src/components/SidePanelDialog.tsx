import { clsx } from "clsx";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  Button as AriaButton,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

type SidePanelDialogProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  titleClassName?: string;
  headerActions?: ReactNode;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelClassName?: string;
};

export const SidePanelDialog = ({
  title,
  subtitle,
  titleClassName,
  headerActions,
  children,
  open,
  onOpenChange,
  panelClassName,
}: SidePanelDialogProps) => {
  const handleClose = () => onOpenChange(false);

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="side-panel-overlay fixed inset-0 z-50 flex items-center justify-end"
    >
      <div className="flex size-full items-center justify-end">
        <Modal
          className={clsx(
            "side-panel relative size-full max-w-[680px] border-l border-gray-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900",
            panelClassName,
          )}
        >
          <Dialog className="flex h-full flex-col overflow-hidden outline-none">
            <AriaButton
              onPress={handleClose}
              className="absolute -left-11 top-3 hidden rounded-full bg-white/90 p-1.5 text-gray-500 shadow-sm transition-colors hover:text-gray-900 dark:bg-slate-800/90 dark:text-slate-400 dark:hover:text-slate-200 sm:flex"
              aria-label="Close panel"
            >
              <X className="size-4" />
            </AriaButton>

            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1 pr-3">
                <Heading
                  slot="title"
                  className={clsx(
                    "truncate text-sm font-medium text-gray-900 dark:text-white",
                    titleClassName,
                  )}
                >
                  {title}
                </Heading>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-slate-500">
                    {subtitle}
                  </p>
                ) : null}
              </div>

              {headerActions ? (
                <div className="flex shrink-0 items-center gap-2">
                  {headerActions}
                </div>
              ) : null}

              <AriaButton
                onPress={handleClose}
                className="ml-2 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 sm:hidden"
                aria-label="Close panel"
              >
                <X className="size-4" />
              </AriaButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </Dialog>
        </Modal>
      </div>
    </ModalOverlay>
  );
};
