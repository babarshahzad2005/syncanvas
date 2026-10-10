# Visual direction: calm minimal chrome, and Elements that store Palette color names

Syncanvas uses calm, minimal chrome in warm grays with one warm-indigo accent, clean geometric shapes (not sketchy), Geist type, and floating panels over an edge-to-edge canvas laid out like FigJam. Light and dark mode are both supported. All of it is specified in `DESIGN.md`.

The decision that is hard to reverse: **Elements store a Palette color name (`red`, `ink`, …), not a color value**, and each theme maps the name to its own shades. Literal colors would make dark mode unreadable on shared Boards, because two Collaborators in different themes see the same Elements. The cost is a fixed palette with no free color picker. Changing this later would mean migrating every stored Board. Exports render the light theme by default.

We considered sketchy hand-drawn rendering and rejected it for v1. Making it match exactly on screen, in SVG, and in PDF would roughly double the renderer work.
