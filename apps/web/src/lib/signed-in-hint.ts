// Whether this device was signed in last time (M6 ticket 08d). Lets a Board open from its local
// copy at once while the session is checked in the background, instead of waiting a round trip.
// Only a hint: the server checks the session on every request, and a stale hint just ends at
// the sign-in page a moment later.

const KEY = "syncanvas.signed-in"

export function seemsSignedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function rememberSignedIn(signedIn: boolean) {
  try {
    if (signedIn) localStorage.setItem(KEY, "1")
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: Boards just wait for the session check, as before.
  }
}
