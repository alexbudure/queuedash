import { useId } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

type SparklineProps = {
  data: number[];
  color: string;
  height?: number;
  width?: number | string;
};

export const Sparkline = ({
  data,
  color,
  height = 36,
  width = "100%",
}: SparklineProps) => {
  const id = useId();

  if (data.length < 2) return null;

  const chartData = data.map((value, index) => ({ value, index }));
  const gradientId = `sparkline-gradient-${id}`;

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart
        data={chartData}
        margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.25}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
