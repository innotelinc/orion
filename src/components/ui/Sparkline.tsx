import { useId } from 'react'

interface SparklineProps {
  values: number[]
  color?: string
  height?: number
  max?: number
  className?: string
  showGrid?: boolean
  label?: string
}

export function Sparkline({
  values,
  color = 'var(--accent)',
  height = 84,
  max,
  className,
  showGrid = true,
  label = 'Live metric trend',
}: SparklineProps) {
  const rawId = useId()
  const gradientId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const safeValues = values.length > 1 ? values : [0, 0]
  const ceiling = Math.max(max ?? 0, ...safeValues, 1)
  const floor = Math.min(...safeValues, 0)
  const range = Math.max(ceiling - floor, 1)
  const points = safeValues.map((value, index) => {
    const x = (index / (safeValues.length - 1)) * 100
    const y = 38 - ((value - floor) / range) * 34
    return [x, y] as const
  })
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L100,40 L0,40 Z`

  return (
    <svg
      className={className}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ height }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showGrid
        ? [8, 16, 24, 32].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--chart-grid)" strokeWidth="0.35" />
          ))
        : null}
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
