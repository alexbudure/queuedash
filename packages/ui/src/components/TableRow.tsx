import type { PropsWithChildren } from "react";

type TableRowProps = {
  isLastRow: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  layoutVariant: "job" | "scheduler";
};
export const TableRow = ({
  isLastRow,
  children,
  isSelected,
  onClick,
  layoutVariant,
}: PropsWithChildren<TableRowProps>) => {
  return (
    <div
      onClick={(e) => onClick(e)}
      aria-label="button"
      className={`group grid w-full cursor-pointer p-2 transition-colors duration-150 active:bg-slate-50/25 dark:active:bg-slate-800/25 ${
        isLastRow ? "border-b border-slate-200 dark:border-slate-700" : ""
      } ${layoutVariant === "job" ? "grid-cols-[auto,350px,576px,1fr]" : "grid-cols-[auto,350px,minmax(0,1fr),minmax(0,1fr)]"} ${
        isSelected
          ? "bg-slate-200/50 dark:bg-slate-800/50"
          : "hover:bg-slate-50/50 dark:hover:bg-slate-900"
      }`}
    >
      {children}
    </div>
  );
};
