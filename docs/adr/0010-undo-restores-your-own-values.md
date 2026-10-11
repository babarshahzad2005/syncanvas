# Undo restores your own previous value, even over a later change by someone else

Undo only reverts the local user's own actions (PRD). When someone else changed the same field after you (you move a shape, a teammate moves it again, you press undo), undo puts back the value from before **your** action, overwriting theirs. This is how Figma behaves. It's Yjs's `ignoreRemoteMapChanges: true`, set in one place (`createUndoManager` in `board-model`), which the app and the convergence suite both use.

Yjs's default is the opposite: it skips any field that someone else changed later. The convergence suite (M1 ticket 02) showed that this default can bring a deleted Element back **without** those fields, for example a rectangle with no position. The board room rejects that update as invalid and disconnects the user, so the default isn't safe for our document shape. Keeping "skip their change" would have needed a custom repair layer around Yjs undo. We chose not to build that.
