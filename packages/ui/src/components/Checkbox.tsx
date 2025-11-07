import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { CheckIcon, DividerHorizontalIcon } from "@radix-ui/react-icons";
import { clsx } from "clsx";

export const Checkbox = ({
  className,
  ...props
}: RadixCheckbox.CheckboxProps) => {
  return (
    <RadixCheckbox.Root
      className={clsx(
        `flex size-4 cursor-pointer rounded-sm border shadow-sm`,
        className,
        {
          "border-slate-300 hover:border-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-400 dark:hover:bg-slate-800":
            !props.checked,
          "border-brand-500 bg-brand-500 text-brand-50 hover:border-brand-600 hover:bg-brand-600":
            props.checked === true,
          "border-slate-500 text-slate-500 hover:border-slate-700 hover:bg-slate-100 dark:border-slate-400 dark:text-slate-400 dark:hover:border-slate-300 dark:hover:bg-slate-800":
            props.checked === "indeterminate",
        }
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex size-full items-center justify-center">
        {props.checked === "indeterminate" && (
          <DividerHorizontalIcon height={12} width={12} />
        )}
        {props.checked === true && <CheckIcon height={12} width={12} />}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
};
