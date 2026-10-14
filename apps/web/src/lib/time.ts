const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** "just now", "5 minutes ago", "yesterday", "last week"… */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000)
  if (Math.abs(seconds) < 45) return "just now"
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(Math.round(seconds / 60), "minute")
}

/** When a daily limit resets, in the viewer's own time: "at 5:00 AM" or "tomorrow at 5:00 AM". */
export function resetTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return at.toDateString() === tomorrow.toDateString() ? `tomorrow at ${time}` : `at ${time}`
}
