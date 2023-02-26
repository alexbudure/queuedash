import type { PropsWithChildren } from "react";
import type { Job } from "../utils/trpc";
import { JobModal } from "./JobModal";
import { useState } from "react";

type JobTableRowProps = {
  isLastRow: boolean;
  job: Job;
  queueName: string;
  isSelected: boolean;
};
export const JobTableRow = ({
  isLastRow,
  job,
  children,
  queueName,
  isSelected,
}: PropsWithChildren<JobTableRowProps>) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setIsOpen(true)}
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

      {isOpen ? (
        <JobModal
          queueName={queueName}
          job={job}
          onDismiss={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
};
