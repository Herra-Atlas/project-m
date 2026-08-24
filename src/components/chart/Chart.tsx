import {
  BarChart as RechartsBarChart,
  Bar,
  LineChart as RechartsLineChart,
  Line,
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '../cn';

export interface ChartPoint {
  label: string;
  value: number;
}

interface ChartProps {
  data: ChartPoint[];
  type?: 'bar' | 'line' | 'area';
  height?: number;
  color?: string;
  title?: string;
}

const COLORS = {
  bar: '#22c55e',
  line: '#3b82f6',
  area: '#8b5cf6',
};

export function ApexChart({
  data,
  type = 'bar',
  height = 300,
  color,
  title,
}: ChartProps) {
  const strokeColor = color || COLORS[type] || COLORS.bar;

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-neutral-500"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const chartData = data.map((d) => ({ name: d.label, value: d.value }));

  const tooltipStyle = {
    backgroundColor: '#18181b',
    border: '1px solid #3f3f46',
    borderRadius: '8px',
    color: '#e4e4e7',
  };

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <RechartsLineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <YAxis
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              dot={{ fill: strokeColor, strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: strokeColor }}
            />
          </RechartsLineChart>
        );

      case 'area':
        return (
          <RechartsAreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gradient-${type}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <YAxis
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#gradient-${type})`}
            />
          </RechartsAreaChart>
        );

      default:
        return (
          <RechartsBarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <YAxis
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={{ stroke: '#374151' }}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar
              dataKey="value"
              fill={strokeColor}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </RechartsBarChart>
        );
    }
  };

  return (
    <div className={cn('w-full')}>
      {title && <h3 className="text-sm font-medium text-neutral-200 mb-2">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
