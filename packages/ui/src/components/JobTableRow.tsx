import type { PropsWithChildren } from "react";
import type { Job } from "../utils/trpc";
import { JobModal } from "./JobModal";
import { useState } from "react";

type JobTableRowProps = {
  isLastRow: boolean;
  job: Job;
  queueName: string;
};
export const JobTableRow = ({
  isLastRow,
  job,
  children,
  queueName,
}: PropsWithChildren<JobTableRowProps>) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setIsOpen(true)}
        aria-label="button"
        className={`group grid w-full cursor-pointer grid-cols-[auto,350px,576px,1fr] p-2 hover:bg-slate-50/50 active:bg-slate-50/25 dark:hover:bg-slate-900 ${
          isLastRow ? "border-b border-slate-200 dark:border-slate-700" : ""
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
