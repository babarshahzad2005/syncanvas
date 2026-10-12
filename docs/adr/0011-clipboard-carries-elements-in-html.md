# Copied Elements travel inside the clipboard's HTML picture

Copying writes three formats at once:

- **`text/html`:** an `<img>` of the selection (a PNG data URL). Its `data-syncanvas` attribute carries the copied Elements as base64 JSON.
- **`image/png`:** the same picture.
- **`web application/x-syncanvas+json`:** the Elements again, where the browser supports custom formats (Chromium).

Pasting reads the HTML from the ordinary paste event. The custom format is never read back.

The spec planned on the custom format alone. In Chrome and Edge, though, reading a custom format means calling `navigator.clipboard.read()`, which shows an "allow this site to see your clipboard" prompt the first time. Firefox and Safari can't write custom formats at all. The HTML in a paste event needs no permission and works in every browser. Pasted into a doc or a chat, it is just the picture. Figma and Miro use the same trick. We still write the custom format so that anything that does read it gets the Elements.

Whatever is in the attribute is untrusted: `parsePayload` keeps only Elements the Board validator accepts, up to the Element cap. If the write to the system clipboard fails (no permission, an older browser), the tab keeps the copy in memory, and a paste in the same tab uses it when the system clipboard is empty.
