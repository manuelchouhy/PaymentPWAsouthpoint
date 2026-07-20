/**
 * Loader de marca: 3 puntos que se conectan en secuencia con líneas de 1px,
 * en vez de un spinner genérico. Ciclo de 1.5s, cyan de marca. Uso: estados
 * de carga de sección/página (no para spinners inline dentro de botones,
 * donde no entra cómodo — ahí se sigue usando .spinner).
 *
 * @param {{ size?: 'sm' | 'md', label?: string }} props
 */
export function NodeLoader({ size = 'md', label }) {
  return (
    <span className={`node-loader node-loader--${size}`} role="status" aria-live="polite">
      <span className="node-loader__dot" aria-hidden="true" />
      <span className="node-loader__edge" aria-hidden="true" />
      <span className="node-loader__dot" aria-hidden="true" />
      <span className="node-loader__edge" aria-hidden="true" />
      <span className="node-loader__dot" aria-hidden="true" />
      <span className="sr-only">{label ?? 'Loading…'}</span>
    </span>
  )
}
