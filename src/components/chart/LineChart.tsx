import { cn } from '../cn';

export interface ChartPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  data: ChartPoint[];
  height?: number;
  color?: string;
  showArea?: boolean;
  title?: string;
}

export function LineChart({
  data,
  height = 300,
  color = '#22c55e',
  showArea = true,
  title,
}: LineChartProps) {
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
  const PAD_TOP = showArea ? 30 : 20;
  const PAD_BOTTOM = 40;
  const VIEW_W = 600;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const slot = plotW / (data.length - 1 || 1);
  const baseY = height - PAD_BOTTOM;

  const points = data.map((d, i) => ({
    x: PAD_LEFT + i * slot,
    y: PAD_TOP + plotH - (d.value / max) * plotH,
  }));

  const areaPath =
    showArea && points.length > 0
      ? `M ${points[0].x},${baseY} ${points.map((p) => `L ${p.x},${p.y}`).join(' ')} L ${points[points.length - 1].x},${baseY} Z`
      : '';

  const linePath = points.length > 0 ? `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}` : '';

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
        {showArea && (
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
        )}

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

        {showArea && areaPath && <path d={areaPath} fill="url(#areaGradient)" />}

        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill={color} />
            <circle cx={p.x} cy={p.y} r={6} fill={color} opacity="0.3" />
          </g>
        ))}

        {data.map((d, i) => (
          <text
            key={i}
            x={PAD_LEFT + i * slot}
            y={baseY + 16}
            textAnchor="middle"
            fontSize={10}
            className="fill-neutral-400"
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
