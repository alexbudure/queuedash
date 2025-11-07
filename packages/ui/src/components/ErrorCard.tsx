type ErrorCardProps = {
  message: string;
};
export const ErrorCard = ({ message }: ErrorCardProps) => {
  return (
    <div className="flex items-center justify-center rounded-md bg-red-50 py-4 dark:bg-red-950/50">
      <div className="flex flex-col justify-center">
        <p className="text-sm text-red-900 dark:text-red-200">{message}</p>
      </div>
    </div>
  );
};
