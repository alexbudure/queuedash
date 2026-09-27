import { clsx } from "clsx";
import type { PropsWithChildren } from "react";

import { FOCUS_RING_INSET } from "../utils/styles";
import {
  getTableGridClassName,
  getTableMinWidthClassName,
  getTableRowPaddingClassName,
  type TableLayoutVariant,
} from "../utils/viewState";
import { useQueuedash } from "./QueuedashProvider";

type TableRowProps = {
  ariaLabel: string;
  hasSeparator: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyboardActivate: () => void;
  layoutVariant: TableLayoutVariant;
  selectable?: boolean;
};
export const TableRow = ({
  ariaLabel,
  hasSeparator,
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
      role="row"
      className={clsx(
        // The border colour is always set and only the width toggles: with
        // both arriving together, `transition-colors` faded the new hairline
        // in from currentColor - a dark (light mode) or bright (dark mode)
        // line flashing under the last row each time a page loaded.
        "group relative grid w-full cursor-pointer border-gray-100/60 px-2 transition-colors duration-150 dark:border-slate-800/60",
        getTableRowPaddingClassName(preferences.density),
        getTableGridClassName(layoutVariant, selectable),
        getTableMinWidthClassName(layoutVariant),
        hasSeparator && "border-b",
        isSelected
          ? "bg-gray-50 active:bg-gray-100 dark:bg-slate-800/60 dark:active:bg-slate-800"
          : "hover:bg-gray-50/50 active:bg-gray-100/70 dark:hover:bg-slate-800/30 dark:active:bg-slate-800/60",
      )}
    >
      {children}
      {/* A row may only contain cells, and an absolutely positioned grid child
          takes no track - so this wrapper adds semantics without a column. */}
      <div
        role="cell"
        className="absolute top-1/2 right-2 z-20 -translate-y-1/2"
      >
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(event) => {
            event.stopPropagation();
            onKeyboardActivate();
          }}
          className={clsx(
            // Focus-only, not hover: at `right-2` this pill is ~83px wide and lands on
            // the 100px metadata track, covering the retried/stack-trace indicators
            // and blocking their tooltips. The whole row is already clickable, so a
            // hover reveal buys nothing and costs two affordances.
            "pointer-events-none rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 focus-visible:pointer-events-auto focus-visible:opacity-100 active:bg-gray-700 dark:bg-slate-100 dark:text-slate-900 dark:active:bg-slate-300",
            FOCUS_RING_INSET,
          )}
        >
          Open details
        </button>
      </div>
    </div>
  );
};
