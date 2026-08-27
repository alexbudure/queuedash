import { clsx } from "clsx";
import { Check, ChevronDown } from "lucide-react";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
} from "react-aria-components";

import { useQueuedash } from "./QueuedashProvider";

export type SelectOption<T extends string> = {
  label: string;
  value: T;
};

type SelectProps<T extends string> = {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
};

export const Select = <T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: SelectProps<T>) => {
  const { portalContainer } = useQueuedash();

  return (
    <AriaSelect
      aria-label={ariaLabel}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
    >
      <Button className="group flex h-9 w-44 max-w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 text-left text-sm text-gray-900 transition outline-none hover:border-gray-300 hover:bg-gray-50 data-[focus-visible=true]:border-brand-400 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:data-[focus-visible=true]:border-brand-600 dark:data-[focus-visible=true]:ring-brand-950">
        <SelectValue className="min-w-0 flex-1 truncate" />
        <ChevronDown className="size-3.5 shrink-0 text-gray-400 transition-transform duration-150 group-aria-[expanded=true]:rotate-180 dark:text-slate-500" />
      </Button>

      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        placement="bottom end"
        offset={6}
        className="entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-150 exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-100 z-50 w-[var(--trigger-width)] min-w-44 rounded-xl border border-gray-100 bg-white p-1 shadow-lg outline-none dark:border-slate-800 dark:bg-slate-900"
      >
        <ListBox className="max-h-64 overflow-y-auto outline-none">
          {options.map((option) => (
            <ListBoxItem
              id={option.value}
              key={option.value}
              textValue={option.label}
              className={({ isFocused, isSelected }) =>
                clsx(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none",
                  isSelected
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                    : "text-gray-700 dark:text-slate-300",
                  isFocused && !isSelected && "bg-gray-50 dark:bg-slate-800",
                )
              }
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{option.label}</span>
                  <Check
                    aria-hidden="true"
                    className={clsx(
                      "size-3.5 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
};
