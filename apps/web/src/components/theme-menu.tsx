import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { parsePreference, setThemePreference, useThemePreference } from "@/lib/theme"

const OPTIONS = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const

export function ThemeMenu() {
  const preference = useThemePreference()
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Theme" />}>
        <current.icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setThemePreference(parsePreference(String(value)))}
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
