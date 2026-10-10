import { PlusIcon } from "lucide-react"
import { AccountMenu } from "@/components/account-menu"
import { Wordmark } from "@/components/brand"
import { ThemeMenu } from "@/components/theme-menu"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

export function Dashboard() {
  const { data: session } = authClient.useSession()
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <Wordmark />
        <div className="flex items-center gap-2">
          <ThemeMenu />
          {session && <AccountMenu user={session.user} />}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
        <h1 className="type-display">Boards</h1>
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
          <div className="flex flex-col gap-1">
            <h2 className="type-heading">No boards yet</h2>
            <p className="text-muted-foreground">
              Create a board to start sketching ideas with your team.
            </p>
          </div>
          <Button disabled>
            <PlusIcon data-icon="inline-start" />
            New board
          </Button>
        </section>
      </main>
    </div>
  )
}
