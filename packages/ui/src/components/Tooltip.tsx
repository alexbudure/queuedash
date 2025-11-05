import type { PropsWithChildren } from "react";
import {
  Button,
  Tooltip as ReactAriaTooltip,
  TooltipTrigger,
} from "react-aria-components";

type TooltipProps = {
  message: string;
};

export const Tooltip = ({
  children,
  message,
}: PropsWithChildren<TooltipProps>) => {
  return (
    <TooltipTrigger>
      <Button>{children}</Button>
      <ReactAriaTooltip
        offset={6}
        className="rounded-md bg-white px-2 py-1 text-sm text-slate-900 shadow-md dark:bg-slate-800 dark:text-slate-100"
      >
        {message}
      </ReactAriaTooltip>
    </TooltipTrigger>
  );
};
