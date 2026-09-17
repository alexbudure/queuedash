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

import {
  FOCUS_RING_DATA,
  OVERLAY_ITEM,
  OVERLAY_SURFACE,
  TEXT_MUTED,
} from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";

export type SelectOption<T extends string> = {
  label: string;
  value: T;
};

type SelectProps<T extends string> = {
  ariaLabel: string;
  className?: string;
  isDisabled?: boolean;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
  /** `sm` for a card's own chrome; `lg` to stand beside a text field. */
  size?: "sm" | "md" | "lg";
  /** `ghost` has no fill of its own until it is hovered. */
  variant?: "filled" | "ghost";
};

const SIZE_CLASS = {
  sm: "h-7 gap-1 rounded-md pr-1.5 pl-2 text-xs",
  md: "h-8 gap-1.5 rounded-lg pr-2 pl-3 text-sm",
  lg: "h-9 gap-1.5 rounded-lg pr-2.5 pl-3 text-sm",
} as const;

const VARIANT_CLASS = {
  filled:
    "bg-gray-100 text-gray-900 hover:bg-gray-200 data-[pressed]:bg-gray-300/70 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:data-[pressed]:bg-slate-600",
  ghost: `${TEXT_MUTED} hover:bg-gray-100 hover:text-gray-900 data-[pressed]:bg-gray-200 dark:hover:bg-slate-800 dark:hover:text-white dark:data-[pressed]:bg-slate-700`,
} as const;

/**
 * A pull-down, not a text field: it used to wear INPUT_CLASS, which made every
 * select look like an empty input with a chevron and, at a fixed 176px, left
 * the chevron stranded far from a two-word value. It is now a button that is
 * as wide as what it says.
 */
export const Select = <T extends string>({
  ariaLabel,
  className,
  isDisabled = false,
  onChange,
  options,
  value,
  size = "md",
  variant = "filled",
}: SelectProps<T>) => {
  const { portalContainer } = useQueuedash();

  return (
    <AriaSelect
      aria-label={ariaLabel}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
      isDisabled={isDisabled}
      // `className` is last so a caller's width wins over the default.
      className={clsx("inline-flex max-w-full", className)}
    >
      <Button
        className={clsx(
          // `group` is load-bearing: the chevron rotates via
          // `group-aria-[expanded=true]`, and aria-expanded sits on this Button.
          "group inline-flex max-w-full min-w-0 items-center font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
          SIZE_CLASS[size],
          VARIANT_CLASS[variant],
          FOCUS_RING_DATA,
        )}
      >
        <SelectValue className="min-w-0 truncate">
          {({ selectedText }) => selectedText}
        </SelectValue>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-gray-500 transition-transform duration-150 group-aria-[expanded=true]:rotate-180 dark:text-slate-400"
        />
      </Button>

      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        placement="bottom end"
        offset={6}
        className={clsx(
          "qd-popover min-w-[max(var(--trigger-width),11rem)] p-1 outline-none",
          OVERLAY_SURFACE,
        )}
      >
        <ListBox className="qd-scroll qd-scroll-contain max-h-64 overflow-y-auto outline-none">
          {options.map((option) => (
            <ListBoxItem
              id={option.value}
              key={option.value}
              textValue={option.label}
              // react-aria's ListBox does not focus an option on hover, so
              // `isHovered` is what gives a mouse user the highlight the
              // keyboard already gets from `isFocused`.
              className={({ isFocused, isHovered, isSelected, isPressed }) =>
                clsx(
                  OVERLAY_ITEM,
                  "justify-between gap-3 transition-colors duration-150",
                  isSelected
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                    : "text-gray-700 dark:text-slate-300",
                  (isFocused || isHovered) &&
                    !isSelected &&
                    "bg-gray-50 dark:bg-slate-700/60",
                  isPressed && !isSelected && "bg-gray-100 dark:bg-slate-700",
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
