import { SlashIcon } from "@radix-ui/react-icons";
import type { ReactElement } from "react";
import { clsx } from "clsx";

type ButtonProps = {
  variant?: "outline" | "filled";
  colorScheme?: "yellow" | "slate" | "red";
  size?: "sm" | "md" | "lg";
  icon?: ReactElement;
  label: string;
  isLoading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};
export const Button = ({
  colorScheme = "slate",
  variant = "outline",
  size = "md",
  icon,
  label,
  isLoading,
  onClick,
  disabled,
}: ButtonProps) => {
  return (
    <button
      onClick={onClick}
      disabled={isLoading || disabled}
      className={clsx(
        "flex items-center space-x-1 rounded-md border text-sm font-medium transition-colors duration-150",
        {
          "py-0.5": size === "sm",
          "py-1": size === "md",
          "py-1.5": size === "lg",
        },
        [
          size === "sm" && icon ? "pl-1.5 pr-2.5" : "px-2.5",
          size === "md" && icon ? "pl-2 pr-3" : "px-3",
          size === "lg" && icon ? "pl-2.5 pr-4" : "px-4",
        ],
        {
          "cursor-not-allowed opacity-50": isLoading || disabled,

          // Yellow outline
          "border-yellow-900 text-yellow-900 hover:bg-yellow-50 focus:bg-yellow-50 dark:border-yellow-400 dark:text-yellow-400 dark:hover:bg-yellow-950/30 dark:focus:bg-yellow-950/30":
            colorScheme === "yellow" && variant === "outline",
          // Slate outline
          "border-slate-900 text-slate-900 hover:bg-slate-50 focus:bg-slate-50 dark:border-slate-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:bg-slate-800":
            colorScheme === "slate" && variant === "outline",
          // Red outline
          "border-red-900 text-red-900 hover:bg-red-50 focus:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950/30 dark:focus:bg-red-950/30":
            colorScheme === "red" && variant === "outline",

          // Yellow filled
          "border-yellow-800 bg-yellow-800 text-yellow-50 hover:border-yellow-900 hover:bg-yellow-900 focus:border-yellow-900 focus:bg-yellow-900 dark:border-yellow-600 dark:bg-yellow-600 dark:hover:border-yellow-500 dark:hover:bg-yellow-500 dark:focus:border-yellow-500 dark:focus:bg-yellow-500":
            colorScheme === "yellow" && variant === "filled",
          // Slate filled
          "border-slate-800 bg-slate-800 text-slate-50 hover:border-slate-900 hover:bg-slate-900 focus:border-slate-900 focus:bg-slate-900 dark:border-slate-600 dark:bg-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-500 dark:focus:border-slate-500 dark:focus:bg-slate-500":
            colorScheme === "slate" && variant === "filled",
          // Red filled
          "border-red-800 bg-red-800 text-red-50 hover:border-red-900 hover:bg-red-900 focus:border-red-900 focus:bg-red-900 dark:border-red-600 dark:bg-red-600 dark:hover:border-red-500 dark:hover:bg-red-500 dark:focus:border-red-500 dark:focus:bg-red-500":
            colorScheme === "red" && variant === "filled",
        }
      )}
    >
      {isLoading ? (
        <div className="flex w-4 justify-center">
          <SlashIcon width={10} height={10} className="animate-spin" />
        </div>
      ) : icon ? (
        <div className="flex w-4 justify-center">{icon}</div>
      ) : null}

      <span>{label}</span>
    </button>
  );
};
