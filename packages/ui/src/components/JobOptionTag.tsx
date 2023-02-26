type JobOptionTagProps = {
  label: string | number;
  icon: React.ReactNode;
};
export const JobOptionTag = ({ label, icon }: JobOptionTagProps) => {
  return (
    <div className="flex cursor-default items-center justify-center space-x-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-sm text-slate-900 transition duration-150 ease-in-out">
      {icon}
      <span>{label}</span>
    </div>
  );
};
