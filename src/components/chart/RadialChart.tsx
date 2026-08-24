import { cn } from '../cn';

export interface RadialSlice {
  label: string;
  value: number;
  color?: string;
}

interface RadialChartProps {
  data: RadialSlice[];
  size?: number;
  title?: string;
  showLegend?: boolean;
  strokeWidth?: number;
}

export function RadialChart({
  data,
  size = 200,
  title,
  showLegend = true,
  strokeWidth = 20,
}: RadialChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-neutral-500" style={{ width: size, height: size }}>
        No data
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2 - 10;
  const innerRadius = radius - strokeWidth;

  const defaultColors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const slices = data.map((d, i) => ({
    ...d,
    color: d.color || defaultColors[i % defaultColors.length],
  }));

  let currentAngle = -Math.PI / 2;

  const arcs = slices.map((slice, i) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const startX = cx + radius * Math.cos(startAngle);
    const startY = cy + radius * Math.sin(startAngle);
    const endX = cx + radius * Math.cos(endAngle);
    const endY = cy + radius * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const midAngle = startAngle + angle / 2;
    const labelRadius = radius + 25;
    const labelX = cx + labelRadius * Math.cos(midAngle);
    const labelY = cy + labelRadius * Math.sin(midAngle);

    const path = `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;

    const percentage = Math.round((slice.value / total) * 100);

    return {
      path,
      color: slice.color,
      label: slice.label,
      percentage,
      labelX,
      labelY,
    };
  });

  return (
    <div className="flex flex-col items-center">
      {title && <h3 className="text-sm font-medium text-neutral-200 mb-3">{title}</h3>}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className={cn('w-full text-neutral-100')}
          style={{ width: size, height: size }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={innerRadius}
            className="fill-neutral-900"
          />

          {arcs.map((arc, i) => (
            <path
              key={i}
              d={arc.path}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          ))}

          <text
            x={cx}
            y={cy - 8}
            textAnchor="middle"
            className="fill-neutral-300"
            fontSize={24}
            fontWeight="bold"
          >
            {total}
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            className="fill-neutral-500"
            fontSize={12}
          >
            Total
          </text>
        </svg>
      </div>

      {showLegend && (
        <div className="mt-4 flex flex-wrap justify-center gap-4">
          {arcs.map((arc, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: arc.color }}
              />
              <span className="text-xs text-neutral-400">
                {arc.label} ({arc.percentage}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
