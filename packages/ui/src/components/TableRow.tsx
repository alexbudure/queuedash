import type { PropsWithChildren } from "react";

type TableRowProps = {
  isLastRow: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKeyboardActivate: () => void;
  layoutVariant: "job" | "scheduler";
};
export const TableRow = ({
  isLastRow,
  children,
  isSelected,
  onClick,
  onKeyboardActivate,
  layoutVariant,
}: PropsWithChildren<TableRowProps>) => {
  return (
    <div
      onClick={(e) => onClick(e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onKeyboardActivate();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Open row details"
      className={`group grid w-full cursor-pointer px-2 py-1.5 transition-colors duration-150 ${
        isLastRow ? "border-b border-gray-100/60 dark:border-slate-800/60" : ""
      } ${layoutVariant === "job" ? "grid-cols-[36px_minmax(200px,35%)_minmax(auto,1fr)_100px]" : "grid-cols-[36px_minmax(0,30%)_1fr_1fr]"} ${
        isSelected
          ? "bg-gray-50 dark:bg-slate-800/60"
          : "hover:bg-gray-50/50 dark:hover:bg-slate-800/30"
      }`}
    >
      {children}
    </div>
  );
};
