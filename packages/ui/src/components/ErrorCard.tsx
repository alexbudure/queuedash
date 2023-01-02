type ErrorCardProps = {
  message: string;
};
export const ErrorCard = ({ message }: ErrorCardProps) => {
  return (
    <div className="flex items-center justify-center rounded-md bg-red-50 py-4">
      <div className="flex flex-col justify-center">
        <p className="text-sm text-red-900">{message}</p>
      </div>
    </div>
  );
};
