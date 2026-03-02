import { Check, Minus } from "lucide-react";
import { clsx } from "clsx";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";

type CheckedState = boolean | "indeterminate";

type CheckboxProps = Omit<
  AriaCheckboxProps,
  "className" | "isSelected" | "isIndeterminate" | "onChange"
> & {
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
      className={({ isSelected, isIndeterminate }) =>
        clsx(
          "flex size-4 cursor-pointer items-center justify-center rounded border",
          className,
          {
            "border-gray-300 hover:border-gray-400 dark:border-slate-600 dark:hover:border-slate-500":
              !isSelected && !isIndeterminate,
            "border-gray-900 bg-gray-900 text-white hover:border-gray-800 hover:bg-gray-800 dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:hover:border-slate-300 dark:hover:bg-slate-300":
              isSelected,
            "border-gray-400 text-gray-500 hover:border-gray-500 dark:border-slate-500 dark:text-slate-400 dark:hover:border-slate-400":
              isIndeterminate,
          },
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
          {isIndeterminate ? <Minus size={10} /> : null}
          {isSelected ? <Check size={10} /> : null}
        </>
      )}
    </AriaCheckbox>
  );
};
