import { avatarColor, initials } from '../lib/avatarColor'

/**
 * Avatar circular con iniciales y color derivado del nombre.
 * @param {{ name: string, size?: 'sm'|'md'|'lg' }} props
 */
export function Avatar({ name, size = 'md' }) {
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ backgroundColor: avatarColor(name) }}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
