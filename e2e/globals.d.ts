// The test hooks board-canvas.tsx exposes when window.__SYNCANVAS_TEST__ is set.
declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
    __syncanvas?: {
      elements: () => {
        id: string
        position: { x: number; y: number }
        size: { w: number; h: number }
        color: string
      }[]
      camera: () => { x: number; y: number; zoom: number }
    }
  }
}

export {}
