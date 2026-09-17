import { clsx } from "clsx";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { CARD_BORDER } from "../utils/styles";

type TableFrameProps = {
  ariaLabel?: string;
  /** The header row. */
  header: ReactNode;
  /** The body rows. */
  children: ReactNode;
  /** Below the table rather than inside it: an empty state or end-of-list. */
  footer?: ReactNode;
  /** Shown in place of the whole table while it loads. */
  skeleton?: ReactNode;
  className?: string;
};

/**
 * The bordered box around a data table, which scrolls with the page rather
 * than inside itself.
 *
 * A table narrower than its columns still has to scroll sideways, but any
 * scroller - even a sideways-only one - would capture a sticky header and pin
 * it to itself instead of the page. So only the rows scroll, and the header
 * sits in a box of its own that is pinned to the page and kept at the rows'
 * horizontal offset.
 */
export const TableFrame = ({
  ariaLabel,
  header,
  children,
  footer,
  skeleton,
  className,
}: TableFrameProps) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hasHiddenColumns, setHasHiddenColumns] = useState(false);
  const isLoading = skeleton != null;

  useEffect(() => {
    const headerElement = headerRef.current;
    const body = bodyRef.current;
    if (!headerElement || !body) return;

    const handleBodyScroll = () => {
      headerElement.scrollLeft = body.scrollLeft;
      setHasHiddenColumns(
        body.scrollLeft < body.scrollWidth - body.clientWidth - 1,
      );
    };
    // Focus landing on a header control scrolls the header by itself. Its
    // echo of a body scroll must not write back, or it cuts the body's own
    // momentum short - and if the ranges ever differ, pins the body to the
    // header's.
    const handleHeaderScroll = () => {
      const echo = Math.min(
        body.scrollLeft,
        headerElement.scrollWidth - headerElement.clientWidth,
      );
      if (Math.abs(headerElement.scrollLeft - echo) > 1) {
        body.scrollLeft = headerElement.scrollLeft;
      }
    };

    handleBodyScroll();
    body.addEventListener("scroll", handleBodyScroll, { passive: true });
    headerElement.addEventListener("scroll", handleHeaderScroll, {
      passive: true,
    });
    // Rows arriving and the page resizing both change what overflows.
    const observer = new ResizeObserver(handleBodyScroll);
    observer.observe(body);
    return () => {
      body.removeEventListener("scroll", handleBodyScroll);
      headerElement.removeEventListener("scroll", handleHeaderScroll);
      observer.disconnect();
    };
  }, [isLoading]);

  return (
    <div
      className={clsx(
        // `clip` rounds the corners without making this a scroller, which
        // would capture the sticky header just the same.
        "overflow-clip rounded-xl",
        CARD_BORDER,
        className,
      )}
    >
      {isLoading ? (
        skeleton
      ) : (
        <>
          <div role="table" aria-label={ariaLabel}>
            {/* Below whatever Layout pins over the top of the page. Rows in
                both boxes clip what spills past them, so the two always
                scroll the same distance. */}
            <div
              ref={headerRef}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The rows are grid divs, and a thead may only hold tr.
              role="rowgroup"
              className="sticky top-[var(--qd-top-inset,0px)] z-10 overflow-hidden border-b border-gray-100/60 bg-gray-50/80 backdrop-blur *:overflow-x-clip dark:border-slate-800/60 dark:bg-slate-900/80"
            >
              {header}
            </div>
            <div
              ref={bodyRef}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- As above. The role also keeps this scroller from surfacing as a nameless node between the table and its rows.
              role="rowgroup"
              className={clsx(
                "qd-scroll qd-table-body overflow-x-auto *:overflow-x-clip",
                // Only the rows fade. On the frame, the mask would stop the
                // header's blur reaching the rows behind it; on the header, it
                // would turn the header's edge see-through.
                hasHiddenColumns && "qd-scroll-fade-end",
              )}
            >
              {children}
            </div>
          </div>
          {footer}
        </>
      )}
    </div>
  );
};
