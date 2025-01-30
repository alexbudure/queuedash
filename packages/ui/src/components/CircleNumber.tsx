export const CircleNumber = ({ number = 0 }) => {
    return (
      <div className="flex items-center justify-center">
        <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center">
          <span className="text-white text-2xl font-bold">
            {number}
          </span>
        </div>
      </div>
    );
  };