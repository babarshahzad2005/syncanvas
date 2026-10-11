// The test hooks board-canvas.tsx exposes when window.__SYNCANVAS_TEST__ is set.
declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
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
      }[]
      camera: () => { x: number; y: number; zoom: number }
    }
  }
}

export {}
