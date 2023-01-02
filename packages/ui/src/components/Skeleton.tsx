type SkeletonProps = {
  className?: string;
};

export const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div
      className={`w-full animate-pulse bg-slate-100 dark:bg-slate-800 ${className}`}
    />
  );
};
