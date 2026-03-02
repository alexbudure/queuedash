import { RotateCw } from "lucide-react";
import type { ReactElement } from "react";
import { clsx } from "clsx";

type ButtonProps = {
  as?: "button" | "span";
  variant?: "outline" | "filled";
  colorScheme?: "yellow" | "slate" | "red";
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
  const content = (
    <>
      {isLoading ? (
        <div className="flex w-4 justify-center">
          <RotateCw width={12} height={12} className="animate-spin" />
        </div>
      ) : icon ? (
        <div className="flex w-4 justify-center">{icon}</div>
      ) : null}

      <span>{label}</span>
    </>
  );

  const classNames = clsx(
    "group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-900",
    {
      "h-7 px-3 text-xs": size === "sm",
      "h-8 px-3.5 text-xs": size === "md",
      "h-9 px-4 text-sm": size === "lg",
    },
    {
      "cursor-not-allowed opacity-50": isLoading || disabled,

      // Yellow outline
      "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:border-amber-700 dark:hover:bg-amber-950":
        colorScheme === "yellow" && variant === "outline",
      // Slate outline (pro-style secondary)
      "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800":
        colorScheme === "slate" && variant === "outline",
      // Red outline
      "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 dark:border-red-800/80 dark:bg-red-950/40 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-950":
        colorScheme === "red" && variant === "outline",

      // Yellow filled
      "border-amber-600 bg-amber-600 text-white hover:border-amber-700 hover:bg-amber-700 dark:border-amber-500 dark:bg-amber-500 dark:hover:border-amber-400 dark:hover:bg-amber-400":
        colorScheme === "yellow" && variant === "filled",
      // Slate filled (pro-style primary)
      "border-gray-700 bg-gray-700 text-white hover:border-gray-800 hover:bg-gray-800 dark:border-slate-300 dark:bg-slate-300 dark:text-slate-900 dark:hover:border-slate-200 dark:hover:bg-slate-200":
        colorScheme === "slate" && variant === "filled",
      // Red filled
      "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700 dark:border-red-500 dark:bg-red-500 dark:hover:border-red-400 dark:hover:bg-red-400":
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
      className={classNames}
    >
      {content}
    </button>
  );
};
