import { clsx } from "clsx";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";

import {
  FOCUS_RING_DATA,
  OVERLAY_ITEM,
  OVERLAY_SURFACE,
  TEXT_FAINT,
} from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";

type Action = {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  tone?: "default" | "warning" | "destructive";
};
type ActionMenuProps = {
  actions: Action[];
  isDisabled?: boolean;
  ariaLabel?: string;
};
export const ActionMenu = ({
  actions,
  isDisabled = false,
  ariaLabel = "Actions",
}: ActionMenuProps) => {
  const { portalContainer } = useQueuedash();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        className={clsx(
          "rounded-md p-1.5 transition-colors duration-150 disabled:opacity-50",
          FOCUS_RING_DATA,
          isDisabled
            ? ""
            : isOpen
              ? "bg-gray-100 dark:bg-slate-800"
              : "hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-slate-800 dark:active:bg-slate-700",
        )}
        aria-label={ariaLabel}
        isDisabled={isDisabled}
      >
        <MoreHorizontal className="size-4 text-gray-500 dark:text-slate-400" />
      </AriaButton>

      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        placement="bottom end"
        offset={6}
        className={clsx(
          "qd-popover min-w-[180px] p-1 outline-none",
          OVERLAY_SURFACE,
        )}
      >
        <Menu className="outline-none">
          {actions.map((action) => {
            const isDestructive = action.tone === "destructive";
            const isWarning = action.tone === "warning";

            return (
              <MenuItem
                className={clsx(
                  OVERLAY_ITEM,
                  "transition-colors duration-150",
                  isDestructive
                    ? "text-red-600 hover:bg-red-50 focus:bg-red-50 data-[pressed]:bg-red-100 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus:bg-red-500/10 dark:data-[pressed]:bg-red-500/20"
                    : isWarning
                      ? "text-orange-600 hover:bg-orange-50 focus:bg-orange-50 data-[pressed]:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-500/10 dark:focus:bg-orange-500/10 dark:data-[pressed]:bg-orange-500/20"
                      : "text-gray-700 hover:bg-gray-50 focus:bg-gray-50 data-[pressed]:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:focus:bg-slate-700/60 dark:data-[pressed]:bg-slate-700",
                )}
                key={action.label}
                onAction={action.onSelect}
              >
                {action.icon ? (
                  <span
                    className={isDestructive || isWarning ? "" : TEXT_FAINT}
                  >
                    {action.icon}
                  </span>
                ) : null}
                <span>{action.label}</span>
              </MenuItem>
            );
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
};
