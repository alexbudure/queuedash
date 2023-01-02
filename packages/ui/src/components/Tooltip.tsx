import * as TooltipRadix from "@radix-ui/react-tooltip";
import type { PropsWithChildren } from "react";

type TooltipProps = {
  message: string;
};

export const Tooltip = ({
  children,
  message,
}: PropsWithChildren<TooltipProps>) => {
  return (
    <TooltipRadix.Provider>
      <TooltipRadix.Root>
        <TooltipRadix.Trigger asChild>{children}</TooltipRadix.Trigger>
        <TooltipRadix.Portal>
          <TooltipRadix.Content
            className="rounded-md bg-white py-1 px-2 text-sm text-slate-900 shadow-md"
            sideOffset={6}
          >
            {message}
            <TooltipRadix.Arrow className="fill-white" />
          </TooltipRadix.Content>
        </TooltipRadix.Portal>
      </TooltipRadix.Root>
    </TooltipRadix.Provider>
  );
};
