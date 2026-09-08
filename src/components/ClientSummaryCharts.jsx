import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { HoursDonut } from './HoursDonut'

// Paleta alineada al resto de la app: consumed cyan, overage ámbar (como los
// badges de overage), remaining gris, budget celeste.
const COLOR = {
  budget: '#38bdf8',
  consumed: '#22d3ee',
  overage: '#f59e0b',
  remaining: '#52525b',
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

/**
 * Los dos gráficos de Client Summary, alimentados por los totales ya filtrados de
 * la página (respetan los filtros aplicados). Gráfica 1: barras Budget vs
 * Consumed vs Overage. Gráfica 2: donut del reparto Consumed / Overage /
 * Remaining. `remaining` viene calculado POR PROYECTO desde la página (suma de
 * max(0, budget − consumed) de cada proyecto con budget), no como budget − consumed
 * global, para no netear el consumo de un proyecto contra el budget de otro.
 *
 * @param {{ totals: { budget: number, consumed: number, overage: number,
 *           remaining: number, hasBudget: boolean } }} props
 */
export function ClientSummaryCharts({ totals }) {
  const budget = totals.hasBudget ? round1(totals.budget) : 0
  const consumed = round1(totals.consumed)
  const overage = round1(totals.overage)
  const remaining = round1(totals.remaining)

  const barData = [
    { name: 'Budget', value: budget, color: COLOR.budget },
    { name: 'Consumed', value: consumed, color: COLOR.consumed },
    { name: 'Overage', value: overage, color: COLOR.overage },
  ]
  const donutData = [
    { key: 'consumed', name: 'Consumed', value: consumed, color: COLOR.consumed },
    { key: 'overage', name: 'Overage', value: overage, color: COLOR.overage },
    { key: 'remaining', name: 'Remaining', value: remaining, color: COLOR.remaining },
  ]
  const donutTotal = consumed + overage + remaining
  const barEmpty = budget === 0 && consumed === 0 && overage === 0

  return (
    <div className="dash-main">
      <div className="dash-widget">
        <div className="dash-widget__head">
          <span className="dash-widget__title">
            <TrendingUp size={14} />
            Budget vs Consumed vs Overage
          </span>
        </div>
        {barEmpty ? (
          <p className="dash-widget__empty">No hour data available.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line-strong)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text)' }} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--text)' }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                formatter={(value, _n, item) => [`${round1(value)} h`, item?.payload?.name]}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
                cursor={{ fill: 'var(--line-strong)', opacity: 0.15 }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {barData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <HoursDonut
        icon={<TrendingUp size={14} />}
        title="Consumed / Overage / Remaining"
        data={donutTotal === 0 ? [] : donutData}
        total={round1(donutTotal)}
      />
    </div>
  )
}
