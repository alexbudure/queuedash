import { clsx } from "clsx";
import { Check, Minus } from "lucide-react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";

import { FOCUS_RING_DATA } from "../utils/styles";

type CheckedState = boolean | "indeterminate";

export const ROW_SELECTION_CHECKBOX_CLASS_NAME =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[focus-visible]:opacity-100";

type CheckboxProps = Omit<
  AriaCheckboxProps,
  "className" | "isSelected" | "isIndeterminate" | "onChange"
> & {
  /**
   * Merged onto the control itself. Dense call sites (table rows) should also
   * pass `HIT_AREA` here so the painted 16px box keeps a ~32px hit target;
   * form checkboxes deliberately do not.
   */
  className?: string;
  checked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
};

export const Checkbox = ({
  className,
  checked,
  onCheckedChange,
  ...props
}: CheckboxProps) => {
  return (
    <AriaCheckbox
      className={({ isSelected, isIndeterminate, isDisabled }) =>
        clsx(
          "flex size-4 cursor-pointer items-center justify-center rounded border transition-colors duration-150 data-[focus-visible]:opacity-100",
          FOCUS_RING_DATA,
          isDisabled && "cursor-not-allowed opacity-50",
          !isSelected &&
            !isIndeterminate &&
            "border-gray-300 bg-white hover:border-gray-400 data-[pressed]:bg-gray-100 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-500 dark:data-[pressed]:bg-slate-800",
          // Indeterminate is a real "some selected" state, so it fills like a
          // checked box rather than reading as an empty one with a dash.
          (isSelected || isIndeterminate) &&
            "border-gray-900 bg-gray-900 text-white hover:border-gray-700 hover:bg-gray-700 data-[pressed]:border-gray-950 data-[pressed]:bg-gray-950 dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:hover:border-white dark:hover:bg-white dark:data-[pressed]:border-slate-300 dark:data-[pressed]:bg-slate-300",
          className,
        )
      }
      isSelected={checked === true}
      isIndeterminate={checked === "indeterminate"}
      onChange={(isSelected) => onCheckedChange?.(isSelected)}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {({ isSelected, isIndeterminate }) => (
        <>
          {isIndeterminate ? <Minus size={10} strokeWidth={3} /> : null}
          {isSelected && !isIndeterminate ? (
            <Check size={10} strokeWidth={3} />
          ) : null}
        </>
      )}
    </AriaCheckbox>
  );
};
