import { clsx } from "clsx";

import { STATUS_ICONS, STATUS_LABELS, STATUS_TINT } from "../utils/status";
import type { Status } from "../utils/trpc";

/** The status a detail panel is looking at, in the header where a reader looks first. */
export const StatusBadge = ({ status }: { status: Status }) => {
  const Icon = STATUS_ICONS[status];

  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        STATUS_TINT[status],
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {STATUS_LABELS[status]}
    </span>
  );
};
