/**
 * Mini-gráfico de línea (1px, cyan brand) para tendencias cortas — p. ej. los
 * últimos 7 días de actividad en una KPI card. Puramente informativo: si no
 * hay al menos 2 puntos con variación, no se dibuja nada (evita una línea
 * plana sin información).
 */
export function Sparkline({ values, width = 56, height = 20, className = '' }) {
  if (!values || values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const flat = max === min
  const stepX = width / (values.length - 1)
  const points = values
    .map((v, i) => {
      const x = i * stepX
      // Serie sin variación (p.ej. todo en 0) → línea recta al medio, no
      // pegada al borde inferior (donde se vuelve invisible contra la card).
      const y = flat ? height / 2 : height - ((v - min) / (max - min)) * (height - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      className={`sparkline ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
