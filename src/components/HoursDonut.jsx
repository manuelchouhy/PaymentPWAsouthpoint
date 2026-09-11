import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

/**
 * Donut de horas con el total en el centro y leyenda a la derecha (patrón del
 * mockup). Componente compartido: lo usan el Dashboard (Billing Status /
 * Allocation) y Client Summary (Consumed / Overage / Remaining).
 *
 * `total` llega como PROP a propósito (NO se deriva de `data`): sumar los slices de
 * `data` reintroduce drift de redondeo (los buckets ya vienen redondeados a 1 decimal).
 * El caller pasa el total crudo (sumado y redondeado una vez). Cada donut puede pasar
 * un total distinto según lo que cuente: en el Dashboard, el de Allocation usa TODAS las
 * horas y el de Billing sólo las facturables (por eso sus centros pueden diferir — es
 * correcto). No lo cambies a un sum(data) al "simplificar".
 *
 * @param {{ icon?: React.ReactNode, title: string,
 *           data: { key: string, name: string, value: number, color: string }[],
 *           total: number }} props
 */
export function HoursDonut({ icon, title, data, total }) {
  return (
    <div className="dash-widget">
      <div className="dash-widget__head">
        <span className="dash-widget__title">
          {icon}
          {title}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="dash-widget__empty">No hour data available.</p>
      ) : (
        <div className="billing-dist">
          {/* Donut con el total en el centro (como el mockup). */}
          <div className="billing-dist__chart">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={64}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} h`, name]}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--text)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="billing-dist__center" aria-hidden="true">
              <span className="billing-dist__total">{total.toFixed(1)}</span>
              <span className="billing-dist__unit">Hours</span>
            </div>
          </div>
          {/* Leyenda a la derecha con las horas de cada categoría. */}
          <ul className="billing-dist__legend">
            {data.map((entry) => (
              <li key={entry.key} className="billing-dist__row">
                <span className="billing-dist__dot" style={{ background: entry.color }} />
                <span className="billing-dist__name">{entry.name}</span>
                <span className="billing-dist__val">{entry.value.toFixed(1)} h</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
