import { indexById, TEMPLATES, type TemplateId } from "@syncanvas/board-model"
import { boundsOf, drawScene } from "@syncanvas/renderer"
import { useEffect, useRef } from "react"
import { fitAll } from "@/lib/thumbnail"
import { cn } from "@/lib/utils"

/**
 * A template tile's picture (M5a ticket 04; DESIGN.md → Templates): the template's own
 * Elements drawn by the renderer in the light theme at the tile's size. No image files.
 */
export function TemplatePreview({ id, className }: { id: TemplateId; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return
    const elements = TEMPLATES[id].elements
    const byId = indexById(elements)
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      // The wrapper's size, not the canvas's: resizing the canvas must not resize the box.
      const w = box.clientWidth
      const h = box.clientHeight
      if (w === 0 || h === 0) return
      // Measured here, once Geist is in: text boxes come from the real font.
      const bounds = boundsOf(elements, byId)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      drawScene(ctx, {
        elements,
        byId,
        camera: fitAll(bounds, { w, h }),
        theme: "light",
        size: { w, h },
        dpr,
        selection: new Set(),
        showGrid: false,
      })
    }
    // Text needs Geist loaded, or it's measured and drawn in a fallback font.
    void document.fonts.ready.then(draw)
    const observer = new ResizeObserver(draw)
    observer.observe(box)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [id])
  return (
    <div ref={boxRef} className={cn("relative overflow-hidden", className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
    </div>
  )
}
