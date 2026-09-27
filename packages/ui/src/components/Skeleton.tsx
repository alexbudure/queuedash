import { clsx } from "clsx";

type SkeletonProps = {
  className?: string;
};

export const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div
      className={clsx("animate-pulse bg-gray-100 dark:bg-slate-800", className)}
    />
  );
};
