import type { PropsWithChildren } from "react";

type JobTableRowProps = {
  isLastRow: boolean;
  isSelected: boolean;
  onClick: () => void;
};
export const JobTableRow = ({
  isLastRow,
  children,
  isSelected,
  onClick,
}: PropsWithChildren<JobTableRowProps>) => {
  return (
    <>
      <div
        onClick={onClick}
        aria-label="button"
        className={`group grid w-full cursor-pointer grid-cols-[auto,350px,576px,1fr] p-2 active:bg-slate-50/25 ${
          isLastRow ? "border-b border-slate-200 dark:border-slate-700" : ""
        } ${
          isSelected
            ? "bg-slate-200/50"
            : "hover:bg-slate-50/50 dark:hover:bg-slate-900"
        }`}
      >
        {children}
      </div>
    </>
  );
};
