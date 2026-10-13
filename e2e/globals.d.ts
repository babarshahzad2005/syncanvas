// The test hooks board-canvas.tsx exposes when window.__SYNCANVAS_TEST__ is set.
declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
    /** Shorter heartbeat timings for tests (see board-connection.ts). */
    __SYNCANVAS_HEARTBEAT__?: { pingEvery: number; deadAfter: number }
    __syncanvas?: {
      elements: () => {
        id: string
        type: string
        /** Absent on connectors, which follow their ends. */
        position?: { x: number; y: number }
        size?: { w: number; h: number }
        color: string
        fill?: string
        points?: number[][]
        width?: string
        text?: string
        fontSize?: string
        bold?: boolean
        align?: string
        ends?: { from: { x: number; y: number }; to: { x: number; y: number } }
        start?: { elementId?: string; anchor?: string; fallback: { x: number; y: number } }
        end?: { elementId?: string; anchor?: string; fallback: { x: number; y: number } }
        style?: string
        groupId?: string
        locked?: boolean
      }[]
      camera: () => { x: number; y: number; zoom: number }
    }
  }
}

export {}
