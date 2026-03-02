import {
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Tooltip as ReactAriaTooltip,
  TooltipTrigger,
} from "react-aria-components";

type TooltipProps = {
  content?: ReactNode;
  message?: ReactNode;
  triggerClassName?: string;
  tooltipClassName?: string;
  placement?: ComponentProps<typeof ReactAriaTooltip>["placement"];
  offset?: number;
  delay?: number;
  closeDelay?: number;
};

export const Tooltip = ({
  children,
  content,
  message,
  triggerClassName,
  tooltipClassName,
  placement = "top",
  offset = 8,
  delay = 350,
  closeDelay = 0,
}: PropsWithChildren<TooltipProps>) => {
  const tooltipContent = content ?? message;
  const portalContainer =
    typeof document !== "undefined" ? document.body : undefined;

  const [isOpen, setIsOpen] = useState(false);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(openTimeoutRef.current);
      clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(closeTimeoutRef.current);
    openTimeoutRef.current = setTimeout(() => setIsOpen(true), delay);
  }, [delay]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(openTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), closeDelay);
  }, [closeDelay]);

  if (tooltipContent == null) return <>{children}</>;

  return (
    <span
      className={`group/tooltip inline-flex min-w-0 items-center ${triggerClassName ?? ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      <TooltipTrigger isOpen={isOpen} delay={0} closeDelay={0}>
        <Button className="pointer-events-none inline-flex min-w-0 items-center bg-transparent p-0 text-left align-middle outline-none">
          {children}
        </Button>
        <ReactAriaTooltip
          UNSTABLE_portalContainer={portalContainer}
          placement={placement}
          offset={offset}
          style={{ zIndex: 2147483647 }}
          className={`z-[9999] rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg dark:bg-slate-800 ${tooltipClassName ?? ""}`}
        >
          {tooltipContent}
        </ReactAriaTooltip>
      </TooltipTrigger>
    </span>
  );
};
