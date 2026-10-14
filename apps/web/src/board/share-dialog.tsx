import {
  INVITE_ROLES,
  type InviteRole,
  type PendingInvitation,
  type Role,
  type SharingMember,
  type SharingResponse,
} from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Loader2, Mail } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { initials } from "@/components/account-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ApiError, api, queryKeys } from "@/lib/api"
import { resetTime } from "@/lib/time"
import { presenceColor } from "@/presence/model"

// The Share button and dialog (DESIGN.md → Share dialog; M3 tickets 01–02): invite by email,
// everyone with access plus pending Invitations, the Owner's Role menu and Remove, and Leave. The server decides what the caller may do
// (`canInvite`, `canResend`, `canCancel`); the dialog only shows those controls.

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
}

const ROLE_HINT: Record<InviteRole, string> = {
  editor: "Can edit",
  commenter: "Can view and comment",
  viewer: "Can view",
}

const VERB: Record<InviteRole, string> = { editor: "edit", commenter: "comment", viewer: "view" }

type ShareProps = {
  boardId: string
  title?: string
  /** Leaves the Board (non-Owners); resolves once you no longer have access. */
  onLeave: () => Promise<void>
}

export function ShareButton({ boardId, title, onLeave }: ShareProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="h-10 rounded-full px-4 shadow-panel" onClick={() => setOpen(true)}>
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 sm:max-w-lg">
          {open && <ShareDialogBody boardId={boardId} title={title} onLeave={onLeave} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ShareDialogBody({ boardId, title, onLeave }: ShareProps) {
  const sharing = useQuery({
    queryKey: queryKeys.sharing(boardId),
    queryFn: () => api.sharing(boardId),
  })
  const state = sharing.data
  return (
    <>
      <div className="flex flex-col gap-1.5 pr-8">
        <DialogTitle className="truncate">
          Share “{state?.board.title ?? title ?? "Board"}”
        </DialogTitle>
        <DialogDescription>
          {!state
            ? "Who has access to this board."
            : state.canInvite.length === 0
              ? "Only the owner and editors can invite people."
              : "Invite people by email. Anyone with an account gets access right away."}
        </DialogDescription>
      </div>
      {state && state.canInvite.length > 0 && (
        <InviteForm boardId={boardId} roles={state.canInvite} />
      )}
      <section aria-labelledby="share-people" className="flex flex-col gap-2">
        <h3 id="share-people" className="type-label text-muted-foreground">
          People with access
        </h3>
        {sharing.isPending ? (
          <p className="flex items-center gap-2 py-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : sharing.isError ? (
          <p role="alert" className="py-2 text-destructive">
            Couldn't load who has access. Check your connection and try again.
          </p>
        ) : (
          <People boardId={boardId} state={sharing.data} />
        )}
      </section>
      {state && state.you.role !== "owner" && (
        <LeaveBoard title={state.board.title} onLeave={onLeave} />
      )}
    </>
  )
}

function InviteForm({ boardId, roles }: { boardId: string; roles: InviteRole[] }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<InviteRole>(roles[0] ?? "viewer")
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => api.invite(boardId, { email, role }),
    onSuccess: async (res) => {
      const address = email.trim().toLowerCase()
      toast(
        res.result === "member" ? `${address} can ${VERB[role]} now` : "Invitation sent",
        res.result === "member" ? undefined : { description: `We emailed ${address}.` },
      )
      setEmail("")
      setError(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.sharing(boardId) })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (email.trim()) send.mutate()
      }}
    >
      <div className="flex gap-2">
        <Input
          type="email"
          aria-label="Email address"
          placeholder="Email address"
          autoComplete="off"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-error" : undefined}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
          className="min-w-0 flex-1"
          autoFocus
        />
        <RoleMenu roles={roles} value={role} onChange={setRole} />
        <Button type="submit" disabled={send.isPending || !email.trim()}>
          {send.isPending && <Loader2 className="animate-spin" />}
          Send
        </Button>
      </div>
      {error && (
        <p id="invite-error" role="alert" className="type-caption text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function errorMessage(e: unknown) {
  if (!(e instanceof ApiError)) return "Couldn't reach Syncanvas. Check your connection."
  const resetsAt = e.details.resetsAt
  return typeof resetsAt === "string"
    ? `${e.message} You can send more ${resetTime(resetsAt)}.`
    : e.message
}

function RoleMenu({
  roles,
  value,
  onChange,
}: {
  roles: InviteRole[]
  value: InviteRole
  onChange: (role: InviteRole) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" aria-label={`Role: ${ROLE_LABEL[value]}`} />}
      >
        {ROLE_LABEL[value]}
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as InviteRole)}>
          {roles.map((r) => (
            <DropdownMenuRadioItem
              key={r}
              value={r}
              closeOnClick
              className="flex-col items-start gap-0"
            >
              <span>{ROLE_LABEL[r]}</span>
              <span className="type-caption text-muted-foreground">{ROLE_HINT[r]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function People({ boardId, state }: { boardId: string; state: SharingResponse }) {
  return (
    <ul className="-mx-2 flex max-h-72 flex-col overflow-y-auto">
      {state.members.map((m) => (
        <MemberRow
          key={m.id}
          boardId={boardId}
          member={m}
          you={m.id === state.you.id}
          canManage={state.canManage && m.role !== "owner"}
        />
      ))}
      {state.invitations.map((i) => (
        <InvitationRow key={i.id} boardId={boardId} invitation={i} />
      ))}
    </ul>
  )
}

const ROW = "flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5"

function MemberRow({
  boardId,
  member,
  you,
  canManage,
}: {
  boardId: string
  member: SharingMember
  you: boolean
  canManage: boolean
}) {
  return (
    <li className={ROW}>
      <span
        aria-hidden
        className="type-label flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] text-white"
        style={{ background: presenceColor(member.id) }}
      >
        {initials(member.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-strong truncate">
          {member.name}
          {you && <span className="font-normal text-muted-foreground"> (you)</span>}
        </span>
        <span className="type-caption truncate text-muted-foreground">{member.email}</span>
      </span>
      {canManage && member.role !== "owner" ? (
        <MemberMenu boardId={boardId} member={member} role={member.role} />
      ) : (
        <span className="type-label text-muted-foreground">{ROLE_LABEL[member.role]}</span>
      )}
    </li>
  )
}

/** The Owner's menu on a Member's row: change their Role, or remove them. */
function MemberMenu({
  boardId,
  member,
  role,
}: {
  boardId: string
  member: SharingMember
  role: InviteRole
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.sharing(boardId) })
  const change = useMutation({
    mutationFn: (next: InviteRole) => api.changeRole(boardId, member.id, { role: next }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.removeMember(boardId, member.id),
    onSuccess: async () => {
      toast(`${member.name} no longer has access`)
      await refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={change.isPending || remove.isPending}
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${member.name}'s role: ${ROLE_LABEL[role]}`}
            className="text-muted-foreground"
          />
        }
      >
        {ROLE_LABEL[role]}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={role}
          onValueChange={(v) => {
            if (v !== role) change.mutate(v as InviteRole)
          }}
        >
          {INVITE_ROLES.map((r) => (
            <DropdownMenuRadioItem
              key={r}
              value={r}
              closeOnClick
              className="flex-col items-start gap-0"
            >
              <span>{ROLE_LABEL[r]}</span>
              <span className="type-caption text-muted-foreground">{ROLE_HINT[r]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => remove.mutate()}>
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Leave board" for everyone but the Owner, after a confirmation. */
function LeaveBoard({ title, onLeave }: { title: string; onLeave: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  return (
    <div className="-mt-1 flex justify-start border-t pt-4">
      <Button
        variant="ghost"
        className="-ml-3 text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Leave board
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Leave “${title}”?`}
        description="It leaves your dashboard, and you'll need a new invitation to get back in."
        confirmLabel="Leave board"
        pending={leaving}
        onConfirm={() => {
          setLeaving(true)
          void onLeave().finally(() => setLeaving(false))
        }}
      />
    </div>
  )
}

function InvitationRow({
  boardId,
  invitation,
}: {
  boardId: string
  invitation: PendingInvitation
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.sharing(boardId) })
  const resend = useMutation({
    mutationFn: () => api.resendInvitation(boardId, invitation.id),
    onSuccess: async () => {
      toast("Invitation sent again", { description: `We emailed ${invitation.email}.` })
      await refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const cancel = useMutation({
    mutationFn: () => api.cancelInvitation(boardId, invitation.id),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e)),
  })
  const busy = resend.isPending || cancel.isPending

  return (
    <li className={ROW}>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Mail className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{invitation.email}</span>
        <span className="type-caption truncate text-muted-foreground">
          Pending · invited by {invitation.invitedBy.name}
        </span>
      </span>
      <span className="type-label text-muted-foreground">{ROLE_LABEL[invitation.role]}</span>
      {invitation.canResend && (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-label={`Resend invitation to ${invitation.email}`}
          onClick={() => resend.mutate()}
        >
          Resend
        </Button>
      )}
      {invitation.canCancel && (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-label={`Cancel invitation to ${invitation.email}`}
          onClick={() => cancel.mutate()}
        >
          Cancel
        </Button>
      )}
    </li>
  )
}
