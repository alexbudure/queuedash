import type { PropsWithChildren } from "react";

import {
  getTableGridClassName,
  type TableLayoutVariant,
} from "../utils/viewState";
import { useQueuedash } from "./QueuedashProvider";

type TableRowProps = {
  ariaLabel: string;
  isLastRow: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyboardActivate: () => void;
  layoutVariant: TableLayoutVariant;
  selectable?: boolean;
};
export const TableRow = ({
  ariaLabel,
  isLastRow,
  children,
  isSelected,
  onClick,
  onKeyboardActivate,
  layoutVariant,
  selectable = true,
}: PropsWithChildren<TableRowProps>) => {
  const { preferences } = useQueuedash();

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- The row has a dedicated native details button for keyboard activation.
    <div
      onClick={(e) => onClick(e)}
      role="group"
      className={`group relative grid w-full cursor-pointer px-2 transition-colors duration-150 ${
        preferences.density === "compact" ? "py-0.5" : "py-2"
      } ${
        isLastRow ? "border-b border-gray-100/60 dark:border-slate-800/60" : ""
      } ${getTableGridClassName(layoutVariant, selectable)} ${
        isSelected
          ? "bg-gray-50 dark:bg-slate-800/60"
          : "hover:bg-gray-50/50 dark:hover:bg-slate-800/30"
      }`}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          onKeyboardActivate();
        }}
        className="pointer-events-none absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 outline-none focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-900"
      >
        Open details
      </button>
      {children}
    </div>
  );
};
