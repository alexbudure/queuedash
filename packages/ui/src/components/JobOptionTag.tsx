import { CounterClockwiseClockIcon } from "@radix-ui/react-icons";

type JobOptionTagProps = {
  label: string | number;
};
export const JobOptionTag = ({ label }: JobOptionTagProps) => {
  return (
    <div className="flex cursor-default items-center justify-center space-x-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-sm text-slate-900 transition duration-150 ease-in-out">
      <CounterClockwiseClockIcon width={12} height={12} />
      <span>{label}</span>
    </div>
  );
};
