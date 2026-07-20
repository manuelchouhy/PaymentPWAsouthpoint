/**
 * Empty state de marca: nodos SIN conectar (el leitmotif del grafo, pero
 * "apagado" — no hay datos, no hay aristas). Mensaje corto y humano, no
 * "AI voice" ("There are no items to display").
 *
 * @param {{ title: string, hint?: string, action?: React.ReactNode }} props
 */
export function EmptyGraph({ title, hint, action }) {
  return (
    <div className="empty-graph">
      <svg
        className="empty-graph__art"
        viewBox="0 0 120 64"
        width="120"
        height="64"
        aria-hidden="true"
      >
        <circle cx="20" cy="18" r="4" />
        <circle cx="58" cy="10" r="3" />
        <circle cx="98" cy="22" r="4.5" />
        <circle cx="38" cy="46" r="3.5" />
        <circle cx="82" cy="50" r="4" />
      </svg>
      <p className="empty-graph__title">{title}</p>
      {hint && <p className="empty-graph__hint">{hint}</p>}
      {action && <div className="empty-graph__action">{action}</div>}
    </div>
  )
}
