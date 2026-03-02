import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { clsx } from "clsx";

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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        className={clsx(
          "rounded-md p-1.5 outline-none transition-colors disabled:opacity-50",
          isOpen
            ? "bg-gray-100 dark:bg-slate-800"
            : "hover:bg-gray-100 dark:hover:bg-slate-800",
        )}
        aria-label={ariaLabel}
        isDisabled={isDisabled}
      >
        <MoreHorizontal className="size-4 text-gray-500 dark:text-slate-400" />
      </AriaButton>

      <Popover
        placement="bottom end"
        offset={4}
        className="entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-150 exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-150 min-w-[160px] rounded-lg border border-gray-100 bg-white p-1 shadow-lg outline-none dark:border-slate-800 dark:bg-slate-900"
      >
        <Menu>
          {actions.map((action) => {
            return (
              <MenuItem
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors",
                  action.tone === "destructive" || action.tone === "warning"
                    ? ""
                    : "text-gray-700 dark:text-slate-300",
                  action.tone === "destructive"
                    ? "text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus:bg-red-500/10"
                    : action.tone === "warning"
                      ? "text-orange-600 hover:bg-orange-50 focus:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-500/10 dark:focus:bg-orange-500/10"
                      : "hover:bg-gray-50 focus:bg-gray-50 dark:hover:bg-slate-800 dark:focus:bg-slate-800",
                )}
                key={action.label}
                onAction={action.onSelect}
              >
                {action.icon ? (
                  <span
                    className={
                      action.tone === "destructive" || action.tone === "warning"
                        ? ""
                        : "text-gray-400 dark:text-slate-500"
                    }
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
