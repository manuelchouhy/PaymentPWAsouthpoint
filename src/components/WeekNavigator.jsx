import { useRef } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react'
import {
  weekStartISO,
  weekEndISO,
  shiftWeekISO,
  formatUsDate,
  sundayWeek,
  sundayWeekYear,
} from '../lib/format'

/**
 * Navegador de semana (filtro year-aware de Entries). Reemplaza el input numérico
 * "W35" por el patrón del mockup: flechas ‹ ›, un botón de calendario para saltar
 * a una semana puntual, y el rango físico completo "08-23-2026 to 08-29-2026
 * (WEEK - 35 · 2026)".
 *
 * Es presentacional: el valor (`value`, el domingo YYYY-MM-DD que inicia la
 * semana, o '' para "sin filtrar") y el `onChange` los maneja la página. Filtra
 * por la semana FÍSICA exacta (ver término "Week" en CONTEXT.md), no por número.
 *
 * Estado "All" (value === ''): muestra "All weeks" y NO filtra. El primer click en
 * cualquier flecha entra en la semana actual (base); a partir de ahí ‹ retrocede y
 * › avanza de a una semana. La × vuelve a "All".
 *
 * @param {{ label?: string, value: string, onChange: (weekStartIso: string) => void }} props
 */
export function WeekNavigator({ label = 'Week', value, onChange }) {
  const dateRef = useRef(null)
  // El botón de calendario está SIEMPRE presente: sirve de destino de foco cuando
  // la × se desmonta al limpiar, para no perder el foco en <body>.
  const calRef = useRef(null)
  const hasValue = String(value ?? '') !== ''

  // Desde "All" cualquier flecha entra en la semana actual; ya dentro, ‹ › se
  // desplazan de a una semana desde el valor vigente. La semana actual se calcula
  // sólo en la rama "All" (perezoso): no hace falta construir un Date en cada
  // render cuando ya hay una semana elegida.
  const go = (delta) => {
    if (hasValue) {
      onChange(shiftWeekISO(value, delta))
      return
    }
    // Fecha LOCAL del usuario, no toISOString() (UTC): para un usuario US un
    // sábado a la noche ya es domingo en UTC y entraría en la semana equivocada.
    // weekStartISO opera sobre el string de fecha-calendario, así que la fecha
    // local da la semana física correcta.
    const now = new Date()
    const todayLocalISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    onChange(weekStartISO(todayLocalISO))
  }

  // Limpiar vuelve a "All" y desmonta la ×: se mueve el foco al calendario (que
  // no se desmonta) para que un usuario de teclado no lo pierda en <body>.
  const clearWeek = () => {
    onChange('')
    calRef.current?.focus()
  }

  // El calendario abre el date-picker nativo; elegir cualquier fecha cae en su
  // semana (se normaliza al domingo). showPicker() necesita el gesto del click,
  // que este handler provee; si el browser no lo soporta, se cae a focus().
  const openPicker = () => {
    const el = dateRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        // showPicker puede tirar (p. ej. sin activación de usuario): cae al focus.
      }
    }
    el.focus()
  }

  const rangeText = hasValue
    ? `${formatUsDate(value)} to ${formatUsDate(weekEndISO(value))}`
    : 'All weeks'

  return (
    <div className="filterfield filterfield--weeknav">
      <span className="filterfield__label">{label}</span>
      <div className="weeknav" role="group" aria-label="Week navigator">
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => go(-1)}
          aria-label={hasValue ? 'Previous week' : 'Go to current week'}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>

        <button
          ref={calRef}
          type="button"
          className="weeknav__cal"
          onClick={openPicker}
          aria-label="Pick a week"
        >
          <CalendarDays size={15} aria-hidden="true" />
        </button>

        <span className="weeknav__range" aria-live="polite">
          <span className="weeknav__dates">{rangeText}</span>
          {hasValue && (
            <span className="weeknav__wk">
              (WEEK - {sundayWeek(value)} · {sundayWeekYear(value)})
            </span>
          )}
        </span>

        {hasValue && (
          <button
            type="button"
            className="weeknav__clear"
            onClick={clearWeek}
            aria-label="Clear week filter"
            title="All weeks"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => go(1)}
          aria-label={hasValue ? 'Next week' : 'Go to current week'}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        {/*
          Date-picker nativo que dispara el botón de calendario. Visualmente
          oculto (no display:none, que rompería showPicker) y fuera del tab
          (tabIndex -1 + pointer-events:none): es un disparador, no un campo que se
          tipee. Al elegir una fecha se normaliza al domingo de su semana; borrarla
          vuelve a "All". SIN aria-hidden a propósito: el fallback de openPicker le
          hace .focus(), y enfocar un nodo aria-hidden es un anti-patrón; el
          aria-label lo hace anunciable si algún AT lo alcanza.
        */}
        <input
          ref={dateRef}
          type="date"
          className="weeknav__date-input"
          aria-label="Pick a week by date"
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? weekStartISO(e.target.value) : '')}
          tabIndex={-1}
        />
      </div>
    </div>
  )
}
