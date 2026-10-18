import { useSearch } from "@tanstack/react-router"
import { ArrowLeft, MailCheck } from "lucide-react"
import { type FormEvent, useState } from "react"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient, safeRedirect } from "@/lib/auth-client"

type State =
  | { step: "enter"; error?: string }
  | { step: "sending" }
  | { step: "sent"; email: string }

const LINK_ERROR =
  "That sign-in link has expired or was already used. Enter your email to get a new one."

export function SignIn() {
  const search = useSearch({ strict: false }) as {
    redirect?: string
    error?: string
    deleted?: unknown
  }
  const redirect = safeRedirect(search.redirect)
  const [email, setEmail] = useState("")
  const [state, setState] = useState<State>({
    step: "enter",
    error: search.error ? LINK_ERROR : undefined,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setState({ step: "sending" })
    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: redirect,
      errorCallbackURL: `/sign-in?redirect=${encodeURIComponent(redirect)}`,
    })
    if (error) {
      setState({
        step: "enter",
        error:
          error.status === 429
            ? "Too many sign-in attempts. Wait a minute, then try again."
            : "We couldn't send a sign-in link. Check the address and try again.",
      })
      return
    }
    setState({ step: "sent", email: email.trim() })
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-9" />
          <h1 className="type-title">
            {state.step === "sent" ? "Check your email" : "Sign in to Syncanvas"}
          </h1>
        </div>

        {/* After Settings → Delete account (M5a ticket 06). */}
        {search.deleted !== undefined && state.step !== "sent" && (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-center">
            Your account was deleted.
          </p>
        )}

        {state.step === "sent" ? (
          <div className="flex flex-col gap-4 rounded-xl bg-surface p-6 text-center shadow-panel">
            <MailCheck className="mx-auto size-6 text-primary" />
            <p>
              We sent a sign-in link to <span className="type-body-strong">{state.email}</span>. It
              works once and expires in 10 minutes.
            </p>
            {import.meta.env.DEV && (
              <p className="type-caption rounded-md bg-muted px-3 py-2 text-muted-foreground">
                Local development: the link is printed in the terminal running pnpm dev.
              </p>
            )}
            <Button variant="ghost" onClick={() => setState({ step: "enter" })}>
              <ArrowLeft data-icon="inline-start" /> Use a different email
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-panel"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={state.step === "enter" && !!state.error}
                aria-describedby={state.step === "enter" && state.error ? "email-error" : undefined}
              />
              {state.step === "enter" && state.error && (
                <p id="email-error" className="type-caption text-destructive">
                  {state.error}
                </p>
              )}
            </div>
            <Button type="submit" disabled={state.step === "sending"}>
              {state.step === "sending" ? "Sending link…" : "Continue with email"}
            </Button>
            <p className="type-caption text-center text-muted-foreground">
              We'll email you a link to sign in. No password needed.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
