import type { PropsWithChildren } from "react";

type TableRowProps = {
  isLastRow: boolean;
  isSelected: boolean;
  onClick: () => void;
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
      onClick={onClick}
      aria-label="button"
      className={`group grid w-full cursor-pointer p-2 active:bg-slate-50/25 ${
        isLastRow ? "border-b border-slate-200 dark:border-slate-700" : ""
      } ${layoutVariant === "job" ? "grid-cols-[auto,350px,576px,1fr]" : "grid-cols-[auto,350px,1fr,1fr]"} ${
        isSelected
          ? "bg-slate-200/50"
          : "hover:bg-slate-50/50 dark:hover:bg-slate-900"
      }`}
    >
      {children}
    </div>
  );
};
