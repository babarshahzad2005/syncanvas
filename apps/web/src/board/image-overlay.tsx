import { worldToScreen } from "@syncanvas/renderer"
import { RotateCcw, X } from "lucide-react"
import { useCanvasView } from "@/comments/store"
import { Button } from "@/components/ui/button"
import { dismissUpload, type ImageTarget, retryUpload, useUploads } from "./images"

// A failed upload's placeholder (DESIGN.md → Images): "Couldn't upload" with Retry, over the
// `muted` box the canvas draws, placed with the canvas camera on every frame.

export function UploadOverlay({ target }: { target: () => ImageTarget }) {
  // The whole list, filtered here: a filtered selector would be a new array on every call.
  const uploads = useUploads((s) => s.uploads)
  const failed = uploads.filter((u) => u.failed)
  const camera = useCanvasView((s) => s.camera)
  useCanvasView((s) => s.frame) // follow pans and zooms
  if (failed.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {failed.map((upload) => {
        const p = worldToScreen(camera, upload.position)
        return (
          <fieldset
            key={upload.id}
            aria-label="Couldn't upload"
            className="absolute flex flex-col items-center justify-center gap-2"
            style={{
              left: p.x,
              top: p.y,
              width: upload.size.w * camera.zoom,
              height: upload.size.h * camera.zoom,
            }}
          >
            <span className="type-caption whitespace-nowrap text-muted-foreground">
              Couldn't upload
            </span>
            <div className="pointer-events-auto flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => retryUpload(target(), upload.id)}>
                <RotateCcw /> Retry
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove"
                onClick={() => dismissUpload(upload.id)}
              >
                <X />
              </Button>
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
