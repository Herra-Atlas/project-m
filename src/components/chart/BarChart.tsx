import { cn } from '../cn';

export interface ChartPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  data: ChartPoint[];
  height?: number;
  color?: string;
  title?: string;
  showValues?: boolean;
}

export function BarChart({
  data,
  height = 300,
  color = '#3b82f6',
  title,
  showValues = true,
}: BarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-neutral-500" style={{ height }}>
        No data
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const PAD_LEFT = 50;
  const PAD_RIGHT = 20;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 50;
  const VIEW_W = 600;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const slot = plotW / data.length;
  const barW = Math.min(40, slot * 0.7);
  const baseY = height - PAD_BOTTOM;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: Math.round(max * t),
    y: PAD_TOP + plotH - plotH * t,
  }));

  return (
    <div className="relative">
      {title && <h3 className="text-sm font-medium text-neutral-200 mb-2">{title}</h3>}
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className={cn('w-full text-neutral-100')}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
      >
        {yTicks.map((tick, i) => (
          <g key={i}>
            <text
              x={PAD_LEFT - 8}
              y={tick.y + 4}
              textAnchor="end"
              fontSize={10}
              className="fill-neutral-500"
            >
              {tick.value}
            </text>
            <line
              x1={PAD_LEFT}
              y1={tick.y}
              x2={VIEW_W - PAD_RIGHT}
              y2={tick.y}
              className="stroke-neutral-800"
              strokeWidth={1}
              strokeDasharray={i === 0 ? '0' : '4 2'}
            />
          </g>
        ))}

        <line
          x1={PAD_LEFT}
          y1={PAD_TOP}
          x2={PAD_LEFT}
          y2={baseY}
          className="stroke-neutral-700"
          strokeWidth={1}
        />
        <line
          x1={PAD_LEFT}
          y1={baseY}
          x2={VIEW_W - PAD_RIGHT}
          y2={baseY}
          className="stroke-neutral-700"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const barH = (d.value / max) * plotH;
          const x = PAD_LEFT + i * slot + slot / 2 - barW / 2;
          const y = PAD_TOP + plotH - barH;

          return (
            <g key={i}>
              <defs>
                <linearGradient id={`barGradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="1" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.6" />
                </linearGradient>
              </defs>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={4}
                fill={`url(#barGradient-${i})`}
              />
              {showValues && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-neutral-300"
                >
                  {d.value}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={baseY + 16}
                textAnchor="middle"
                fontSize={10}
                className="fill-neutral-400"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
