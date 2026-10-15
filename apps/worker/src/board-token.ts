import type { Role } from "@syncanvas/shared"
import { type CryptoKey, importJWK, jwtVerify, SignJWT } from "jose"

// Board tokens (TECH_STACK §5): short-lived EdDSA JWTs. The API signs one after checking the
// session and Membership; the board room verifies it with the public key, no database call.

export const BOARD_TOKEN_TTL_SECONDS = 5 * 60
const ISSUER = "syncanvas-api"
const AUDIENCE = "syncanvas-board-room"

export type BoardTokenKind = "member" | "guest" | "embed"
export type BoardTokenClaims = {
  userId: string
  /** The display name others see (M2): the board room vouches for it in presence. */
  name: string
  boardId: string
  role: Role
  kind: BoardTokenKind
}

/**
 * A verified token's claims, plus when it was issued in milliseconds (the "iatMs" claim), so
 * an access change and a token issued in the same second can still be told apart.
 */
export type VerifiedBoardToken = BoardTokenClaims & { issuedAt: number }

/** Keys are stored as base64url-encoded JWK JSON (see scripts/gen-keys.mjs). */
async function importKey(encoded: string): Promise<CryptoKey> {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const jwk = JSON.parse(atob(base64))
  return (await importJWK(jwk, "EdDSA")) as CryptoKey
}

const keyCache = new Map<string, Promise<CryptoKey>>()
const key = (encoded: string) => {
  let k = keyCache.get(encoded)
  if (!k) {
    k = importKey(encoded)
    keyCache.set(encoded, k)
  }
  return k
}

export async function signBoardToken(
  claims: BoardTokenClaims,
  privateKey: string,
  now = Date.now(),
) {
  const iat = Math.floor(now / 1000)
  const exp = iat + BOARD_TOKEN_TTL_SECONDS
  const token = await new SignJWT({
    board: claims.boardId,
    role: claims.role,
    kind: claims.kind,
    name: claims.name,
    iatMs: now,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(await key(privateKey))
  return { token, expiresAt: new Date(exp * 1000).toISOString() }
}

/** Returns the claims of a valid, unexpired token, or null for anything else. */
export async function verifyBoardToken(
  token: string,
  publicKey: string,
): Promise<VerifiedBoardToken | null> {
  try {
    const { payload } = await jwtVerify(token, await key(publicKey), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["EdDSA"],
    })
    const { sub, board, role, kind, name, iat, iatMs } = payload as Record<string, unknown>
    if (typeof sub !== "string" || typeof board !== "string") return null
    if (typeof name !== "string" || typeof iat !== "number") return null
    if (role !== "owner" && role !== "editor" && role !== "commenter" && role !== "viewer")
      return null
    if (kind !== "member" && kind !== "guest" && kind !== "embed") return null
    const issuedAt = typeof iatMs === "number" ? iatMs : iat * 1000
    return { userId: sub, name, boardId: board, role, kind, issuedAt }
  } catch {
    return null
  }
}
