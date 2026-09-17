import {
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
  useRef,
  useState,
} from "react";
import {
  Focusable,
  Tooltip as ReactAriaTooltip,
  TooltipTrigger,
} from "react-aria-components";

import { Z_INDEX } from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";

type TooltipProps = {
  content?: ReactNode;
  message?: ReactNode;
  /** Names the trigger for assistive tech. Defaults to "More information". */
  triggerLabel?: string;
  triggerClassName?: string;
  tooltipClassName?: string;
  placement?: ComponentProps<typeof ReactAriaTooltip>["placement"];
  offset?: number;
  delay?: number;
  closeDelay?: number;
  /** For a tooltip that repeats a label rather than adding to it: it only
   *  opens while some of that label is cut off. */
  whenTruncated?: boolean;
};

/** Whether any text inside `element` is cut short by an ellipsis. */
const hasTruncatedText = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLElement>("*")).some(
    (node) =>
      node.scrollWidth > node.clientWidth &&
      getComputedStyle(node).textOverflow === "ellipsis",
  );

export const Tooltip = ({
  children,
  content,
  message,
  triggerLabel = "More information",
  triggerClassName,
  tooltipClassName,
  placement = "top",
  offset = 8,
  delay = 300,
  closeDelay = 120,
  whenTruncated = false,
}: PropsWithChildren<TooltipProps>) => {
  const { portalContainer } = useQueuedash();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [isRedundant, setIsRedundant] = useState(false);
  const tooltipContent = content ?? message;

  if (tooltipContent == null) return <>{children}</>;

  return (
    <span
      ref={wrapperRef}
      className={`group/tooltip inline-flex min-w-0 items-center ${triggerClassName ?? ""}`}
    >
      {/* Uncontrolled, so react-aria owns the timing: it applies `delay` on
          open, shares a warm-up group across triggers (scanning a row does not
          restart a fresh countdown per cell), and dismisses on Escape.
          Driving `isOpen` by hand here fought react-aria's own 0ms hover and
          made every tooltip pop instantly. */}
      <TooltipTrigger
        delay={delay}
        closeDelay={closeDelay}
        // Measured as it opens rather than ahead of time - columns resize and
        // rows re-render under polling. The update lands in the same render
        // as the open, so a redundant tooltip never flashes.
        onOpenChange={(isOpen) => {
          if (!isOpen || !whenTruncated || !wrapperRef.current) return;
          setIsRedundant(!hasTruncatedText(wrapperRef.current));
        }}
      >
        {/* `Focusable`, not `Button`: a react-aria Button consumes the click via
            usePress, so the job name - the largest target in a table row -
            stopped opening the row's detail panel. Focusable wires hover, focus
            and aria-describedby without intercepting the press.
            The role + label are required: Focusable warns (and drops the ARIA
            wiring) on a child with no interactive role.
            `excludeFromTabOrder` is deliberate: JobTable renders ~14 tooltips
            per row, so leaving them focusable added ~180 no-op tab stops to a
            single page. The content they carry is duplicated as a `title` or an
            `sr-only` label at each call site, which is the accessible path. */}
        <Focusable excludeFromTabOrder>
          <span
            role="img"
            aria-label={triggerLabel}
            className="inline-flex min-w-0 cursor-[inherit] items-center text-left align-middle outline-none"
          >
            {children}
          </span>
        </Focusable>
        {whenTruncated && isRedundant ? null : (
          <ReactAriaTooltip
            UNSTABLE_portalContainer={portalContainer ?? undefined}
            placement={placement}
            offset={offset}
            style={{ zIndex: Z_INDEX.tooltip }}
            className={`rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg dark:bg-slate-700 ${tooltipClassName ?? ""}`}
          >
            {tooltipContent}
          </ReactAriaTooltip>
        )}
      </TooltipTrigger>
    </span>
  );
};
