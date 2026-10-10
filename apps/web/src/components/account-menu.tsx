import { useNavigate } from "@tanstack/react-router"
import { LogOut, Monitor, Moon, Settings, Sun, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { authClient, type Session } from "@/lib/auth-client"
import { parsePreference, setThemePreference, useThemePreference } from "@/lib/theme"
import { clearAllLocalCopies } from "@/sync/local-copy"

export function initials(email: string) {
  const name = email.split("@")[0] ?? ""
  const parts = name.split(/[._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase()
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const

/** Account avatar menu (DESIGN.md → Dashboard): Trash, Settings, theme, and sign out. */
export function AccountMenu({ user }: { user: Session["user"] }) {
  const navigate = useNavigate()
  const theme = useThemePreference()

  async function signOut() {
    await authClient.signOut()
    // Saved Boards on this device belong to the person signing out.
    await clearAllLocalCopies()
    await navigate({ to: "/sign-in" })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account"
            className="type-label flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background pointer-coarse:size-11"
          />
        }
      >
        {initials(user.email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* Trash and Settings arrive in M5. */}
        <DropdownMenuItem disabled>
          <Trash2 /> Trash
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setThemePreference(parsePreference(String(value)))}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon /> {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
