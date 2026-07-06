import { Line, LineChart, YAxis } from 'recharts';
import type { SparkPoint } from '../types';

/** Tiny 30-day rank sparkline. Y axis reversed so rank 1 sits at the top. */
export function Sparkline({ points }: { points: SparkPoint[] | undefined }) {
  if (!points || points.length < 2) {
    return <span className="dim">·</span>;
  }
  return (
    <LineChart width={110} height={26} data={points} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
      <YAxis hide reversed domain={['dataMin', 'dataMax']} />
      <Line
        type="monotone"
        dataKey="rank"
        stroke="var(--spark)"
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}
