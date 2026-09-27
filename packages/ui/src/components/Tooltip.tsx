import {
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
  whenTruncated = false,
}: PropsWithChildren<TooltipProps>) => {
  const { portalContainer } = useQueuedash();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [isRedundant, setIsRedundant] = useState(false);

  if (content == null) return <>{children}</>;

  return (
    <span
      ref={wrapperRef}
      className="group/tooltip inline-flex min-w-0 items-center"
    >
      {/* Uncontrolled, so react-aria owns the timing: it applies `delay` on
          open, shares a warm-up group across triggers (scanning a row does not
          restart a fresh countdown per cell), and dismisses on Escape.
          Driving `isOpen` by hand here fought react-aria's own 0ms hover and
          made every tooltip pop instantly. */}
      <TooltipTrigger
        delay={300}
        closeDelay={120}
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
            The trigger is an `<a>` with no `href`: Focusable accepts it by tag,
            and browsers expose it as a plain generic container, so the text
            inside it and any `sr-only` label read as they are and the open
            tooltip is its description. A span needs an interactive role to
            satisfy Focusable, and the `role="img"` + "More information" label
            used for that made everything inside presentational - screen
            readers heard "More information, image" instead of the job name,
            its timings and "Retried".
            `excludeFromTabOrder` is deliberate: JobTable renders ~14 tooltips
            per row, so leaving them focusable added ~180 no-op tab stops to a
            single page. What each trigger shows stays the accessible path; the
            tooltip only adds detail. */}
        <Focusable excludeFromTabOrder>
          {/* oxlint-disable-next-line jsx-a11y/anchor-is-valid -- Deliberately not a link; see above. */}
          <a className="inline-flex min-w-0 cursor-[inherit] items-center text-left align-middle outline-none">
            {children}
          </a>
        </Focusable>
        {whenTruncated && isRedundant ? null : (
          <ReactAriaTooltip
            UNSTABLE_portalContainer={portalContainer ?? undefined}
            placement="top"
            offset={8}
            style={{ zIndex: Z_INDEX.tooltip }}
            className="rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg dark:bg-slate-700"
          >
            {content}
          </ReactAriaTooltip>
        )}
      </TooltipTrigger>
    </span>
  );
};
