import type { ImageElement, Size } from "@syncanvas/board-model"
import type { ImageSource, ImageState } from "@syncanvas/renderer"
import { imageUrl } from "@syncanvas/shared"
import { ApiError } from "@/lib/api"

// The image cache (M5b ticket 03): no React, so the Embed viewer (M6 ticket 06) can use it too.
// The file comment of ./images.ts explains how files are fetched and retried.

// ---------- The image cache ----------

/** Pictures are decoded no bigger than this on their longer side (a 5 MB file can be huge). */
const MAX_DECODE_SIDE = 4096
/** Waits between tries for a file that hasn't reached this region yet (about 60 s in all). */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]

/**
 * Headers that let this tab read the Board's images: none for a Member (the session cookie
 * goes along), a board token for a Guest. `fresh`: the last one was refused, get a new one.
 */
export type ImageAuth = (fresh: boolean) => Promise<Record<string, string>>

type Entry = { state: ImageState; tries: number }

async function decode(blob: Blob, natural?: Size): Promise<ImageBitmap> {
  const side = natural ? Math.max(natural.w, natural.h) : 0
  if (natural && side > MAX_DECODE_SIDE) {
    const k = MAX_DECODE_SIDE / side
    return createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(natural.w * k)),
      resizeHeight: Math.max(1, Math.round(natural.h * k)),
      resizeQuality: "high",
    })
  }
  return createImageBitmap(blob)
}

class ImageCache {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private auth: ImageAuth = async () => ({})

  /** Sets how this tab reads images (once per Board). */
  setAuth(auth: ImageAuth) {
    this.auth = auth
  }

  /** Called whenever a file finishes loading (or is given up on). */
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** For the renderer: the file behind an image Element, loading it the first time. */
  readonly get: ImageSource = (e: ImageElement) => {
    let entry = this.entries.get(e.key)
    if (!entry) {
      entry = { state: "loading", tries: 0 }
      this.entries.set(e.key, entry)
      void this.load(e.key, entry, e.natural)
    }
    return entry.state
  }

  /** Test hook: how far a file has got (null before anything asked for it). */
  stateOf(key: string): "ready" | "loading" | "missing" | null {
    const state = this.entries.get(key)?.state
    return state === undefined ? null : typeof state === "object" ? "ready" : state
  }

  /** A file this tab just uploaded: no need to download it again. */
  seed(key: string, bitmap: ImageBitmap) {
    this.entries.set(key, { state: { bitmap }, tries: 0 })
    this.notify()
  }

  /** A file's bytes, for copying it to another Board. */
  async blob(key: string): Promise<Blob> {
    const res = await this.fetch(key)
    if (!res.ok) throw new ApiError(res.status, "Couldn't read the image.")
    return res.blob()
  }

  private async fetch(key: string) {
    const res = await fetch(imageUrl(key), {
      credentials: "same-origin",
      headers: await this.auth(false),
    })
    // A Guest's board token lasts 5 minutes; get a new one and try once more.
    if (res.status !== 403) return res
    const headers = await this.auth(true)
    if (Object.keys(headers).length === 0) return res
    return fetch(imageUrl(key), { credentials: "same-origin", headers })
  }

  private async load(key: string, entry: Entry, natural: Size) {
    try {
      const res = await this.fetch(key)
      if (res.ok) {
        entry.state = { bitmap: await decode(await res.blob(), natural) }
        return this.notify()
      }
      // 404: not in this region's KV yet. Anything else won't get better by waiting.
      if (res.status !== 404) return this.giveUp(entry)
    } catch {
      // Offline, or a file that won't decode: try again like a missing one.
    }
    const wait = RETRY_MS[entry.tries++]
    if (wait === undefined) return this.giveUp(entry)
    setTimeout(() => void this.load(key, entry, natural), wait)
  }

  private giveUp(entry: Entry) {
    entry.state = "missing"
    this.notify()
  }

  private notify() {
    for (const l of this.listeners) l()
  }
}

/** One cache for the app: image keys are unique across Boards. */
export const imageCache = new ImageCache()
