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
        "flex items-center space-x-1 rounded-md border text-sm font-medium",
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

          "border-yellow-900 text-yellow-900 hover:bg-yellow-50 focus:bg-yellow-50":
            colorScheme === "yellow" && variant === "outline",
          "border-slate-900 text-slate-900 hover:bg-slate-50 focus:bg-slate-50":
            colorScheme === "slate" && variant === "outline",
          "border-red-900 text-red-900 hover:bg-red-50 focus:bg-red-50":
            colorScheme === "red" && variant === "outline",

          "border-yellow-800 bg-yellow-800 text-yellow-50 hover:border-yellow-900 hover:bg-yellow-900 focus:border-yellow-900 focus:bg-yellow-900":
            colorScheme === "yellow" && variant === "filled",
          "border-slate-800 bg-slate-800 text-slate-50 hover:border-slate-900 hover:bg-slate-900 focus:border-slate-900 focus:bg-slate-900":
            colorScheme === "slate" && variant === "filled",
          "border-red-800 bg-red-800 text-red-50 hover:border-red-900 hover:bg-red-900 focus:border-red-900 focus:bg-red-900":
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
