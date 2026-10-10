import { useSyncExternalStore } from "react"

/** The viewer's theme choice. "system" follows the OS (DESIGN.md: Colors → Dark mode). */
export type ThemePreference = "system" | "light" | "dark"
export type Theme = "light" | "dark"

/** Keep in sync with the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = "syncanvas-theme"

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light"
  return preference
}

export function parsePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system"
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)")
const listeners = new Set<() => void>()

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return "system"
  }
}

let preference: ThemePreference = typeof window === "undefined" ? "system" : readPreference()

function apply() {
  const theme = resolveTheme(preference, darkQuery().matches)
  document.documentElement.classList.toggle("dark", theme === "dark")
  for (const listener of listeners) listener()
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this session.
  }
  apply()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const query = darkQuery()
  query.addEventListener("change", apply)
  return () => {
    listeners.delete(listener)
    query.removeEventListener("change", apply)
  }
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => "system",
  )
}

/** The theme actually showing ("system" resolved against the OS), kept live. */
export function useResolvedTheme(): Theme {
  const preference = useThemePreference()
  const systemDark = useSyncExternalStore(
    (onChange) => {
      const query = darkQuery()
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => darkQuery().matches,
    () => false,
  )
  return resolveTheme(preference, systemDark)
}
