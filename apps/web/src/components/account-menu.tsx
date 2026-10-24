import { displayNameOf } from "@syncanvas/shared"
import { Link, useNavigate } from "@tanstack/react-router"
import { LogOut, Monitor, Moon, Settings, Sun, Trash2, UserPen } from "lucide-react"
import { useState } from "react"
import { NameDialog } from "@/components/name-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
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
import { rememberSignedIn } from "@/lib/signed-in-hint"
import { parsePreference, setThemePreference, useThemePreference } from "@/lib/theme"
import { clearAllLocalCopies } from "@/sync/local-copy"

/** Up to two initials from a display name: "Ada Lovelace" → "AL", "Ada" → "AD". */
export function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  const [first = "", second] = parts
  const letters = second ? [...first][0] + ([...second][0] ?? "") : [...first].slice(0, 2).join("")
  return letters.toLocaleUpperCase()
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const

/** Account avatar menu (DESIGN.md → Dashboard): Trash, Settings, theme, and sign out. */
export function AccountMenu({ user: initialUser }: { user: Session["user"] }) {
  const navigate = useNavigate()
  const theme = useThemePreference()
  // The live session, so a new display name shows at once.
  const user = authClient.useSession().data?.user ?? initialUser
  const name = displayNameOf(user)
  const [renaming, setRenaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function signOut() {
    await authClient.signOut()
    rememberSignedIn(false)
    // Saved Boards on this device belong to the person signing out.
    await clearAllLocalCopies()
    await navigate({ to: "/sign-in" })
  }

  return (
    <>
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
          {initials(name)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="type-body-strong truncate text-foreground">{name}</span>
              <span className="truncate">{user.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <UserPen /> Display name…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link to="/trash" />}>
            <Trash2 /> Trash
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
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
      <NameDialog user={user} mode="edit" open={renaming} onOpenChange={setRenaming} />
      <SettingsDialog userId={user.id} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
