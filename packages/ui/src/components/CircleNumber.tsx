import React from 'react';

export const CircleNumber = ({ number = 0,  label = "" }) => {
  return (
    <div className="flex flex-col items-center w-28">
      <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center">
        <span className="text-white text-2xl font-bold">
          {number}
        </span>
      </div>
      <div className="flex flex-col items-center mt-1">
        <span className="text-gray-700 text-sm text-center whitespace-nowrap">
          {label}
        </span>
      </div>
    </div>
  );
};

export default CircleNumber;