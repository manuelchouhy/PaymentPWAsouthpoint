import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { HoursDonut } from './HoursDonut'

// Paleta alineada al resto de la app: consumed cyan, overage ámbar (como los
// badges de overage), remaining gris, budget celeste.
const COLOR = {
  budget: '#38bdf8',
  consumed: '#22d3ee',
  invoiced: '#10b981', // emerald: horas ya facturadas (porción de consumed)
  pending: '#a3a3a3',
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
 *           pending: number, invoiced: number, remaining: number, hasBudget: boolean } }} props
 */
export function ClientSummaryCharts({ totals }) {
  const budget = totals.hasBudget ? round1(totals.budget) : 0
  const consumed = round1(totals.consumed)
  const overage = round1(totals.overage)
  const pending = round1(totals.pending || 0)
  const remaining = round1(totals.remaining)
  // invoiced (C11) es una porción de consumed (horas ya facturadas). El resto de
  // consumed son horas consumidas todavía sin facturar. Se clampa por si un redondeo
  // dejara invoiced levemente por encima de consumed.
  const invoiced = Math.min(round1(totals.invoiced || 0), consumed)
  const consumedUnbilled = round1(Math.max(0, consumed - invoiced))

  // La barra Budget solo si hay budget cargado: sin budget, una barra en 0 leería
  // como "budget cero" en vez de "sin budget" (igual criterio que el donut, que
  // suelta la porción Remaining en ese caso). Pending (horas facturables sin
  // aprobar) va como barra propia para que también se vea en el gráfico.
  // El consumido se PARTE (no se duplica) en la barra: Invoiced (ya facturado) +
  // Consumed (la porción aún sin facturar), igual que el donut. Así Invoiced+Consumed
  // suman el consumido total y las dos gráficas dicen lo mismo; una barra Invoiced
  // aparte del Consumed completo leería como el doble de horas. Sin invoiced, una
  // sola barra "Consumed" como antes.
  const barData = [
    ...(totals.hasBudget ? [{ name: 'Budget', value: budget, color: COLOR.budget }] : []),
    ...(invoiced > 0
      ? [
          { name: 'Invoiced', value: invoiced, color: COLOR.invoiced },
          // La porción sin facturar sólo si queda algo (mismo criterio que el donut).
          // Se rotula "Consumed (unbilled)" igual que el donut: cuando se parte, la
          // barra Consumed ya no es el consumido total sino la porción sin facturar,
          // así que el label lo dice para no leerse como "consumido = 12h".
          ...(consumedUnbilled > 0
            ? [{ name: 'Consumed (unbilled)', value: consumedUnbilled, color: COLOR.consumed }]
            : []),
        ]
      : [{ name: 'Consumed', value: consumed, color: COLOR.consumed }]),
    { name: 'Pending', value: pending, color: COLOR.pending },
    { name: 'Overage', value: overage, color: COLOR.overage },
  ]
  // El título del widget lista exactamente las barras dibujadas, en su orden real:
  // así nunca anuncia "Invoiced" si no hay barra Invoiced, ni contradice el orden.
  const barTitle = barData.map((d) => d.name).join(' · ')
  // El consumido se parte en Invoiced (ya facturado) + Consumed (aún sin facturar)
  // para que se vea la porción invoiced. Si no hay invoiced, una sola porción
  // "Consumed" como antes. La suma Invoiced+Consumed sigue siendo el consumido total,
  // así que loggedHours (centro del donut) no cambia.
  const donutData = [
    ...(invoiced > 0
      ? [
          { key: 'invoiced', name: 'Invoiced', value: invoiced, color: COLOR.invoiced },
          // La porción sin facturar sólo si queda algo: si todo el consumido está
          // facturado (consumedUnbilled === 0) no se agrega un slice/leyenda en 0.
          ...(consumedUnbilled > 0
            ? [{ key: 'consumed', name: 'Consumed (unbilled)', value: consumedUnbilled, color: COLOR.consumed }]
            : []),
        ]
      : [{ key: 'consumed', name: 'Consumed', value: consumed, color: COLOR.consumed }]),
    { key: 'overage', name: 'Overage', value: overage, color: COLOR.overage },
  ]
  // La porción Remaining solo tiene sentido si hay budget cargado: sin budget,
  // "Remaining 0" leería como "todo consumido", que es falso (no hay contra qué medir).
  if (totals.hasBudget) {
    donutData.push({ key: 'remaining', name: 'Remaining', value: remaining, color: COLOR.remaining })
  }
  // Suma de las porciones del donut (incluye Remaining si hay budget): define su
  // estado vacío. Con budget>0 y sin horas logueadas sigue habiendo porción
  // Remaining, así que el donut se dibuja (no cae a "No hour data").
  const donutTotal = donutData.reduce((sum, d) => sum + d.value, 0)
  // Centro del donut = horas REALMENTE logueadas (consumed + overage), no la suma
  // de las porciones (que incluye el remaining, que no son horas trabajadas).
  const loggedHours = round1(consumed + overage)
  // Un solo criterio de "sin datos" para las dos gráficas, así no muestran estados
  // vacíos distintos lado a lado.
  const noData = budget === 0 && consumed === 0 && overage === 0 && pending === 0

  return (
    <section className="cs-charts">
      <p className="state__hint">
        Budget status across all periods — the Week filter narrows the table only, not these charts.
      </p>
      <div className="dash-main">
      <div className="dash-widget">
        <div className="dash-widget__head">
          <span className="dash-widget__title">
            <TrendingUp size={14} />
            {barTitle}
          </span>
        </div>
        {noData ? (
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
        title={invoiced > 0 ? 'Invoiced / Consumed / Overage / Remaining' : 'Consumed / Overage / Remaining'}
        // El donut usa SU propio vacío (donutTotal): el pending no es parte del
        // donut, así que un scope solo-pending muestra "No hour data" acá aunque
        // el gráfico de barras sí dibuje su barra Pending.
        data={donutTotal === 0 ? [] : donutData}
        total={loggedHours}
      />
      </div>
    </section>
  )
}
