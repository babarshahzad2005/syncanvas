import { generateNKeysBetween } from "fractional-indexing"
import type * as Y from "yjs"
import { pasteElements } from "./clipboard"
import type {
  Anchor,
  ConnectorElement,
  ElementWithId,
  PaletteColor,
  Point,
  StickyColor,
  StickySize,
  TextSize,
} from "./model"

// ---------- Templates (M5a ticket 04; PRD A6) ----------
//
// Five starting points, as ordinary Elements: headings are text, columns are light shapes,
// cards are sticky notes, and flows use connectors. A new Board from a template gets them
// as its first edit (with fresh ids, like a paste), so they can be changed or undone like
// anything else. Previews on the dashboard are drawn from these same Elements.

export const TEMPLATE_IDS = ["retro", "brainstorm", "flowchart", "journey", "kanban"] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value)
}

type Box = { x: number; y: number; w: number; h: number }
/** Elements without z: it's added in drawing order once the template is built. */
/** Omit that keeps the union of Element types apart. */
type WithoutZ<T> = T extends unknown ? Omit<T, "z"> : never
type Draft = WithoutZ<ElementWithId> & { box?: Box }

/** Same ratio as the renderer's text layout (LINE_HEIGHT), for centering labels. */
const LINE_HEIGHT = 1.3
const TEXT_PX: Record<TextSize, number> = { S: 16, M: 20, L: 28, XL: 40 }

function heading(id: string, at: Point, text: string, fontSize: TextSize = "XL"): Draft {
  return {
    id,
    type: "text",
    position: at,
    size: { w: 0, h: TEXT_PX[fontSize] * LINE_HEIGHT },
    color: "ink",
    text,
    fontSize,
    bold: true,
    align: "left",
    autoWidth: true,
  }
}

function note(id: string, at: Point, text: string, width = 640): Draft {
  return {
    id,
    type: "text",
    position: at,
    size: { w: width, h: TEXT_PX.S * LINE_HEIGHT },
    color: "gray",
    text,
    fontSize: "S",
    bold: false,
    align: "left",
    autoWidth: false,
  }
}

function shape(
  id: string,
  type: "rect" | "ellipse",
  box: Box,
  color: PaletteColor,
): Draft & { box: Box } {
  return {
    id,
    type,
    position: { x: box.x, y: box.y },
    size: { w: box.w, h: box.h },
    color,
    fill: "light",
    box,
  }
}

/** A label centered in a shape (shapes hold no text themselves). */
function label(id: string, box: Box, text: string, fontSize: TextSize = "M", bold = true): Draft {
  const h = TEXT_PX[fontSize] * LINE_HEIGHT
  return {
    id,
    type: "text",
    position: { x: box.x + 8, y: box.y + (box.h - h) / 2 },
    size: { w: box.w - 16, h },
    color: "ink",
    text,
    fontSize,
    bold,
    align: "center",
    autoWidth: false,
  }
}

function sticky(
  id: string,
  at: Point,
  width: number,
  color: StickyColor,
  text = "",
  fontSize: StickySize = "S",
): Draft & { box: Box } {
  return {
    id,
    type: "sticky",
    position: at,
    size: { w: width, h: width },
    color,
    text,
    fontSize,
    bold: false,
    // Short text keeps a sticky note square.
    box: { x: at.x, y: at.y, w: width, h: width },
  }
}

function anchorPoint(box: Box, anchor: Anchor): Point {
  switch (anchor) {
    case "top":
      return { x: box.x + box.w / 2, y: box.y }
    case "bottom":
      return { x: box.x + box.w / 2, y: box.y + box.h }
    case "left":
      return { x: box.x, y: box.y + box.h / 2 }
    case "right":
      return { x: box.x + box.w, y: box.y + box.h / 2 }
  }
}

function connect(
  id: string,
  from: { id: string; box: Box },
  fromAnchor: Anchor,
  to: { id: string; box: Box },
  toAnchor: Anchor,
  style: ConnectorElement["style"] = "straight",
  color: PaletteColor = "gray",
): Draft {
  return {
    id,
    type: "connector",
    color,
    style,
    start: { elementId: from.id, anchor: fromAnchor, fallback: anchorPoint(from.box, fromAnchor) },
    end: { elementId: to.id, anchor: toAnchor, fallback: anchorPoint(to.box, toAnchor) },
  }
}

/** Gives the drafts z keys in drawing order and drops the helper boxes. */
function build(drafts: Draft[]): ElementWithId[] {
  const keys = generateNKeysBetween(null, null, drafts.length)
  return drafts.map(({ box: _box, ...e }, i) => ({ ...e, z: keys[i] }) as ElementWithId)
}

// ---------- The five ----------

function retro(): ElementWithId[] {
  const columns = [
    { title: "Went well", color: "green", sticky: "green", prompt: "What helped us?" },
    { title: "To improve", color: "red", sticky: "pink", prompt: "What slowed us down?" },
    { title: "Action items", color: "blue", sticky: "blue", prompt: "One thing to try next" },
  ] as const
  const drafts: Draft[] = [
    heading("title", { x: 0, y: 0 }, "Retro"),
    note("hint", { x: 0, y: 64 }, "Add notes to each column, then agree on what to act on."),
  ]
  for (const [i, c] of columns.entries()) {
    const x = i * 400
    const y = 120
    drafts.push(shape(`col-${i}`, "rect", { x, y, w: 360, h: 560 }, c.color))
    drafts.push(heading(`col-${i}-title`, { x: x + 24, y: y + 24 }, c.title, "L"))
    drafts.push(sticky(`col-${i}-a`, { x: x + 24, y: y + 96 }, 150, c.sticky, c.prompt))
    drafts.push(sticky(`col-${i}-b`, { x: x + 186, y: y + 96 }, 150, c.sticky))
  }
  return build(drafts)
}

function brainstorm(): ElementWithId[] {
  const center = shape("topic", "ellipse", { x: 420, y: 330, w: 320, h: 160 }, "violet")
  const colors: StickyColor[] = ["yellow", "orange", "pink", "blue", "green", "violet"]
  const ideas = colors.map((color, i) => {
    const left = i < 3
    const row = i % 3
    return sticky(
      `idea-${i}`,
      { x: left ? 60 : 940, y: 150 + row * 180 },
      160,
      color,
      i === 0 ? "One idea per note" : "",
    )
  })
  return build([
    heading("title", { x: 60, y: 0 }, "Brainstorm"),
    note("hint", { x: 60, y: 64 }, "Write the question in the middle, then add ideas around it."),
    center,
    label("topic-label", center.box, "Main question"),
    ...ideas,
    ...ideas.map((idea, i) =>
      i < 3
        ? connect(`link-${i}`, idea, "right", center, "left")
        : connect(`link-${i}`, idea, "left", center, "right"),
    ),
  ])
}

function flowchart(): ElementWithId[] {
  const start = shape("start", "ellipse", { x: 0, y: 120, w: 200, h: 80 }, "green")
  const step = shape("step", "rect", { x: 0, y: 260, w: 200, h: 80 }, "blue")
  const decide = shape("decide", "rect", { x: 0, y: 400, w: 200, h: 80 }, "orange")
  const next = shape("next", "rect", { x: 0, y: 560, w: 200, h: 80 }, "blue")
  const fix = shape("fix", "rect", { x: 300, y: 400, w: 200, h: 80 }, "blue")
  const end = shape("end", "ellipse", { x: 0, y: 700, w: 200, h: 80 }, "red")
  return build([
    heading("title", { x: 0, y: 0 }, "Flowchart"),
    note("hint", { x: 0, y: 64 }, "Rename the steps, and add more with the shape tools.", 520),
    start,
    step,
    decide,
    next,
    fix,
    end,
    label("start-label", start.box, "Start"),
    label("step-label", step.box, "First step"),
    label("decide-label", decide.box, "Decision?"),
    label("next-label", next.box, "Next step"),
    label("fix-label", fix.box, "Fix it"),
    label("end-label", end.box, "End"),
    connect("a", start, "bottom", step, "top"),
    connect("b", step, "bottom", decide, "top"),
    connect("c", decide, "bottom", next, "top"),
    connect("d", decide, "right", fix, "left"),
    connect("e", fix, "top", step, "right", "elbow"),
    connect("f", next, "bottom", end, "top"),
    label("yes", { x: 100, y: 490, w: 72, h: 40 }, "Yes", "S", false),
    label("no", { x: 212, y: 400, w: 72, h: 40 }, "No", "S", false),
  ])
}

function journey(): ElementWithId[] {
  const stages = ["Discover", "Sign up", "First use", "Get value", "Come back"]
  const rows = [
    { title: "Doing", color: "blue" },
    { title: "Thinking", color: "yellow" },
    { title: "Feeling", color: "pink" },
  ] as const
  const headers = stages.map((_, i) =>
    shape(`stage-${i}`, "rect", { x: 140 + i * 220, y: 120, w: 200, h: 64 }, "violet"),
  )
  const drafts: Draft[] = [
    heading("title", { x: 0, y: 0 }, "User journey"),
    note(
      "hint",
      { x: 0, y: 64 },
      "Follow one person through each stage: what they do, think, and feel.",
    ),
    ...headers,
    ...headers.map((h, i) => label(`stage-${i}-label`, h.box, stages[i] ?? "", "M")),
    ...headers
      .slice(1)
      .map((h, i) => connect(`flow-${i}`, headers[i] as typeof h, "right", h, "left")),
  ]
  for (const [r, row] of rows.entries()) {
    const y = 220 + r * 200
    drafts.push(heading(`row-${r}`, { x: 0, y: y + 64 }, row.title, "M"))
    for (const [i] of stages.entries()) {
      drafts.push(sticky(`card-${r}-${i}`, { x: 160 + i * 220, y }, 160, row.color))
    }
  }
  return build(drafts)
}

function kanban(): ElementWithId[] {
  const columns = [
    {
      title: "To do",
      color: "yellow",
      cards: ["Write the brief", "Sketch ideas", "Plan the launch"],
    },
    { title: "In progress", color: "orange", cards: ["Build the first version"] },
    { title: "Done", color: "green", cards: ["Set up this board"] },
  ] as const
  const drafts: Draft[] = [
    heading("title", { x: 0, y: 0 }, "Kanban"),
    note("hint", { x: 0, y: 64 }, "Move cards to the right as work moves along."),
  ]
  for (const [i, c] of columns.entries()) {
    const x = i * 352
    const y = 120
    drafts.push(shape(`col-${i}`, "rect", { x, y, w: 320, h: 520 }, "gray"))
    drafts.push(heading(`col-${i}-title`, { x: x + 20, y: y + 20 }, c.title, "L"))
    for (const [j, text] of c.cards.entries()) {
      const at = { x: x + 20 + (j % 2) * 148, y: y + 84 + Math.floor(j / 2) * 148 }
      drafts.push(sticky(`col-${i}-card-${j}`, at, 132, c.color, text))
    }
  }
  return build(drafts)
}

export const TEMPLATES: Record<TemplateId, { name: string; elements: ElementWithId[] }> = {
  retro: { name: "Retro", elements: retro() },
  brainstorm: { name: "Brainstorm", elements: brainstorm() },
  flowchart: { name: "Flowchart", elements: flowchart() },
  journey: { name: "User journey", elements: journey() },
  kanban: { name: "Kanban", elements: kanban() },
}

/**
 * Adds a template's Elements to the Board as one transaction (one undo step), with fresh
 * ids and connectors attached to the new Elements. Returns the new ids.
 */
export function applyTemplate(doc: Y.Doc, id: TemplateId, origin: unknown): string[] {
  return pasteElements(doc, TEMPLATES[id].elements, { x: 0, y: 0 }, origin)
}
