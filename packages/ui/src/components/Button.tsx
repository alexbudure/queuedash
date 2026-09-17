import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import type { ReactElement } from "react";

import { FOCUS_RING } from "../utils/styles";

type ButtonProps = {
  as?: "button" | "span";
  variant?: "outline" | "filled";
  colorScheme?: "yellow" | "slate" | "red" | "brand";
  size?: "sm" | "md" | "lg";
  icon?: ReactElement;
  label: string;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
};
export const Button = ({
  as = "button",
  colorScheme = "slate",
  variant = "outline",
  size = "md",
  icon,
  label,
  isLoading,
  onClick,
  disabled,
  className,
  type = "button",
}: ButtonProps) => {
  // Width must not change when a request starts. With an icon the spinner sits
  // in the existing icon slot; without one it overlays the label, which stays
  // in flow (`invisible`) to hold the width. Reserving the slot on `isLoading`
  // instead would have grown the button by 22px at the moment of the click.
  const content = (
    <>
      {icon ? (
        <span className="relative flex w-4 shrink-0 justify-center">
          <span
            aria-hidden={isLoading ? "true" : undefined}
            className={clsx("flex", isLoading && "invisible")}
          >
            {icon}
          </span>
          {isLoading ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            </span>
          ) : null}
        </span>
      ) : null}

      {/* No second opacity here: the root already carries `opacity-70` while
          loading, and CSS opacity multiplies down the tree. */}
      <span className={clsx(isLoading && !icon && "invisible")}>{label}</span>

      {isLoading && !icon ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        </span>
      ) : null}
    </>
  );

  const classNames = clsx(
    "relative inline-flex items-center justify-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-colors duration-150",
    FOCUS_RING,
    {
      "h-7 px-3 text-xs": size === "sm",
      "h-8 px-3.5 text-xs": size === "md",
      "h-9 px-4 text-sm": size === "lg",
    },
    {
      // "in flight" and "form incomplete" used to be pixel-identical.
      "cursor-progress opacity-70": isLoading,
      "cursor-not-allowed opacity-50": disabled && !isLoading,

      // Yellow outline
      "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 active:bg-amber-200 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:border-amber-700 dark:hover:bg-amber-950 dark:active:bg-amber-900/60":
        colorScheme === "yellow" && variant === "outline",
      // Slate outline (pro-style secondary)
      "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:active:bg-slate-700":
        colorScheme === "slate" && variant === "outline",
      // Red outline
      "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 active:bg-red-200 dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-950 dark:active:bg-red-900/60":
        colorScheme === "red" && variant === "outline",

      // Yellow filled
      "border-amber-600 bg-amber-600 text-white hover:border-amber-700 hover:bg-amber-700 active:bg-amber-800 dark:border-amber-500 dark:bg-amber-500 dark:hover:border-amber-400 dark:hover:bg-amber-400 dark:active:bg-amber-300":
        colorScheme === "yellow" && variant === "filled",
      // Brand filled: the one primary action per view. Confirmations and
      // warnings keep their own colours below.
      "border-brand-600 bg-brand-600 text-white hover:border-brand-700 hover:bg-brand-700 active:bg-brand-800 dark:border-brand-600 dark:bg-brand-600 dark:hover:border-brand-500 dark:hover:bg-brand-500 dark:active:bg-brand-700":
        colorScheme === "brand" && variant === "filled",
      // Red filled
      "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700 active:bg-red-800 dark:border-red-500 dark:bg-red-500 dark:hover:border-red-400 dark:hover:bg-red-400 dark:active:bg-red-300":
        colorScheme === "red" && variant === "filled",
    },
    className,
  );

  if (as === "span") {
    return <span className={classNames}>{content}</span>;
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isLoading || disabled}
      aria-busy={isLoading || undefined}
      className={classNames}
    >
      {content}
    </button>
  );
};
