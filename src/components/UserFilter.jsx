import { ChevronDown, Users } from 'lucide-react'

/**
 * Filtro por proveedor. <select> nativo (accesible) con estilo propio.
 * @param {{ users: string[], value: string, onChange: (v: string) => void }} props
 */
export function UserFilter({ users, value, onChange }) {
  return (
    <label className="filter">
      <span className="filter__label">Filtrar por proveedor</span>
      <span className="filter__control">
        <Users size={15} className="filter__icon" aria-hidden="true" />
        <select
          className="filter__select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Filtrar entradas por proveedor"
        >
          <option value="all">All users</option>
          {users.map((user) => (
            <option key={user} value={user}>
              {user}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="filter__chevron" aria-hidden="true" />
      </span>
    </label>
  )
}
