
export const DEFAULT_AVATAR_COLORS = [
  { bg: '#532326', fg: '#e9646b' }, // Red
  { bg: '#5a301d', fg: '#f68b54' }, // Orange
  { bg: '#4b3c1b', fg: '#dfa839' }, // Yellow
  { bg: '#1b3e34', fg: '#50c18d' }, // Green
  { bg: '#154146', fg: '#46c1c8' }, // Teal
  { bg: '#173955', fg: '#55a5ee' }, // Blue
  { bg: '#34254b', fg: '#9768e1' }, // Purple
  { bg: '#4f2038', fg: '#db5f9a' }, // Pink
  { bg: '#4a4a4a', fg: '#a6a6a6' }, // Grey
  { bg: '#4a3e3d', fg: '#b69a98' }, // Brownish
]

export const getAvatarColor = (jid: string): { bg: string; fg: string } => {
  let hash = 0
  for (let i = 0; i < jid.length; i++) {
    hash = jid.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % DEFAULT_AVATAR_COLORS.length
  return DEFAULT_AVATAR_COLORS[index]
}

export const DefaultUserIcon = ({ color }: { color: string }) => (
  <svg width="100%" height="100%" viewBox="-12 -12 48 48" fill={color} className="block">
    <path d="M12 2C8.69 2 6 4.69 6 8C6 11.31 8.69 14 12 14C15.31 14 18 11.31 18 8C18 4.69 15.31 2 12 2ZM12 16C8.67 16 2 17.67 2 21V22H22V21C22 17.67 15.33 16 12 16Z" />
  </svg>
)

export const DefaultGroupIcon = ({ color }: { color: string }) => (
  <svg width="100%" height="100%" viewBox="-12 -12 48 48" fill={color} className="block">
    <path d="M16 11C17.66 11 18.99 9.66 18.99 8C18.99 6.34 17.66 5 16 5C14.34 5 13 6.34 13 8C13 9.66 14.34 11 16 11ZM8 11C9.66 11 10.99 9.66 10.99 8C10.99 6.34 9.66 5 8 5C6.34 5 5 6.34 5 8C5 9.66 6.34 11 8 11ZM8 13C5.67 13 1 14.17 1 16.5V19H15V16.5C15 14.17 10.33 13 8 13ZM16 13C15.71 13 15.38 13.02 15.03 13.05C16.19 13.89 17 15.02 17 16.5V19H23V16.5C23 14.17 18.33 13 16 13Z" />
  </svg>
)
