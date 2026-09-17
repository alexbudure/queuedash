import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

type SparklineProps = {
  data: number[];
  color: string;
  height?: number;
  width?: number | `${number}%`;
  /**
   * Upper bound for the y-axis. Two sparklines read side by side have to share
   * one: left to auto-scale, 20,000 completions and 2 failures draw the same
   * amplitude, and the pair says the opposite of what the numbers say.
   */
  domainMax?: number;
};

export const Sparkline = ({
  data,
  color,
  height = 36,
  width = "100%",
  domainMax,
}: SparklineProps) => {
  const id = useId();

  // A single sample (or a flat series) draws as a bare coloured rule under the
  // number, which reads as a stray divider rather than a chart. Reserve the
  // height so rows still line up, but draw nothing.
  const isChartable =
    data.length >= 2 && data.some((value) => value !== data[0]);

  if (!isChartable) {
    return (
      <div aria-hidden="true" className="min-w-0 flex-1" style={{ height }} />
    );
  }

  const chartData = data.map((value, index) => ({ value, index }));

  const gradientId = `sparkline-gradient-${id}`;

  return (
    <div aria-hidden="true" className="min-w-0 flex-1" style={{ height }}>
      <ResponsiveContainer width={width} height={height}>
        <AreaChart
          data={chartData}
          margin={{ top: 2, right: 0, bottom: 1, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {domainMax !== undefined && domainMax > 0 ? (
            <YAxis hide domain={[0, domainMax]} />
          ) : null}
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
    </div>
  );
};
