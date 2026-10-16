# The board room keeps where Detached Threads were

A Thread pinned to an Element needs somewhere to sit once that Element is deleted: its last position, faded and marked "detached" (PRD A5). Only the board room sees the deletion happen, so only it can know where the Element was.

The board room keeps the Element ids that have Threads (it learns them from the API's `thread-added` events) and, in its own SQLite storage, the last box of each one that was deleted. When an update deletes an anchored Element, the room stores its box and tells everyone on the Board; when someone joins, it sends them the boxes it holds. Clients place a detached pin at the same spot of that box the pin had on the Element.

TECH_STACK planned for the room to report the position back to the API (`/api/internal/*` with a shared secret), which would store it as `threads.last_x/last_y` in Postgres. That needs a second secret, an HTTP hop out of the room, and a write path into Postgres from the room, all to store something the room already has. Keeping it in the room matches ADR 0006: the room owns everything about Board content, and an Element's position is Board content. The `last_x`/`last_y` columns stay unused for now.

Trade-offs:
- If the API's call to the room fails when a Thread is created, the room never learns that Element is anchored, and its pin disappears instead of detaching when the Element is deleted. The call is logged, and creating a Thread doesn't fail because of it.
- Connectors have no stored box, so a Thread pinned to a deleted connector disappears instead of detaching.
- The boxes are kept per Element, so a Board's anchored Elements bound their number.
