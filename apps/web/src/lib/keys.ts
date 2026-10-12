// Shortcut labels for the user's platform: ⌘ and ⇧ on Apple devices, Ctrl and Shift
// elsewhere. Shortcuts are written once as "Mod Shift G" and shown with `keyLabel`.

const apple =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  )

const NAMES: Record<string, string> = apple
  ? { Mod: "⌘", Shift: "⇧", Alt: "⌥" }
  : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt" }

/** One key's label: "Mod" becomes ⌘ or Ctrl. */
export function keyName(key: string): string {
  return NAMES[key] ?? key
}

/** A whole shortcut for a tooltip or menu: "Mod Shift G" becomes "⌘ ⇧ G" or "Ctrl Shift G". */
export function keyLabel(shortcut: string): string {
  return shortcut.split(" ").map(keyName).join(" ")
}
