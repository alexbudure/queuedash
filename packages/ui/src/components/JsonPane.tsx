import { clsx } from "clsx";
import { JSONTree } from "react-json-tree";

import { getJsonTreeTheme } from "../utils/jsonTheme";
import { CARD_BORDER } from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";

/**
 * The one recessed pane for read-only code-like content: JSON, logs, stack
 * traces. The height cap is what keeps a 400-key payload from pushing
 * everything below it thousands of pixels down.
 */
export const RECESSED_PANE = clsx(
  "qd-scroll max-h-80 overflow-auto rounded-lg bg-gray-50/50 dark:bg-slate-900/50",
  CARD_BORDER,
);

/** Enough to show a payload's shape; deeper nodes are opened on demand. */
const expandTopTwoLevels = (
  _keyPath: readonly (string | number)[],
  _data: unknown,
  level: number,
) => level < 2;

const expandAll = () => true;

export const JsonPane = ({
  data,
  expand = "shape",
  className,
}: {
  data: unknown;
  /** `shape` opens two levels; `all` opens everything (small templates). */
  expand?: "shape" | "all";
  className?: string;
}) => {
  const { isDark } = useQueuedash();

  return (
    <div
      className={clsx("data-json-renderer text-xs", RECESSED_PANE, className)}
    >
      <JSONTree
        data={data}
        theme={getJsonTreeTheme(isDark)}
        invertTheme={false}
        hideRoot
        shouldExpandNodeInitially={
          expand === "all" ? expandAll : expandTopTwoLevels
        }
      />
    </div>
  );
};
