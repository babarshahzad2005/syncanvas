# Syncanvas

A real-time collaborative whiteboard: people draw, write, and comment together on shared boards in the browser.

## Language

### People and access

**User**:
Anyone with a Syncanvas account.
_Avoid_: Account, person

**Owner**:
The single User a Board belongs to. Every Board has exactly one Owner.
_Avoid_: Creator, admin

**Member**:
A User who holds a saved Role on a Board.
_Avoid_: Collaborator (when meaning access), teammate, participant

**Collaborator**:
Someone currently present on a Board, whether a Member or a Guest.
_Avoid_: Member (when meaning presence), viewer (when meaning presence)

**Guest**:
An anonymous visitor viewing a Board through a link, who never holds a Role and is never a Member.
_Avoid_: Anonymous user, visitor

**Role**:
The level of access a Member has on a Board: Owner, Editor, Commenter, or Viewer.
_Avoid_: Permission, access level

**Invitation**:
A pending offer of a Role on a Board, sent to an email address, that becomes a Membership when that address signs in.
_Avoid_: Invite link, share

**Share Link**:
The single URL a Board can have that grants a Role to whoever opens it. A signed-in User who opens it becomes a Member, and a Guest gets view access only.
_Avoid_: Public link, invite link

**Embed**:
A read-only, live view of a Board placed on another website. It can be revoked on its own, separately from the Share Link.
_Avoid_: Widget, iframe, public link

### Boards and content

**Board**:
One shared, infinite canvas and everything on it.
_Avoid_: Canvas, document, whiteboard, file

**Element**:
Any single object on a Board, such as a shape, connector, text, sticky note, image, or pen stroke.
_Avoid_: Object, item, node, shape (when meaning any element)

**Folder**:
A User's private grouping of Boards they can open, whether owned or shared with them. Folders are never shared.
_Avoid_: Project, workspace, collection

**Palette color**:
One of the named colors an Element can have, such as ink, red, or blue. Each theme shows it in its own shade.
_Avoid_: Hex color, custom color, swatch

**Trash**:
Where a deleted Board stays for 30 days, visible only to its Owner, who can restore it from there.
_Avoid_: Archive, recycle bin

**Version**:
A saved past state of a Board that Editors can preview and restore.
_Avoid_: Snapshot, revision, backup

**Group**:
A set of Elements that are selected and moved together. Groups are not nested, and a group with fewer than two Elements dissolves.
_Avoid_: Frame, container, folder (when meaning Elements)

**Connector**:
A line whose ends attach to Elements and follow them when they move. If an attached Element is deleted, that end stays where the Element last was.
_Avoid_: Arrow (an arrow is a free line that attaches to nothing), link, edge

**Lock**:
A state of an Element that prevents accidental selection or movement. Any Editor can lift it.
_Avoid_: Freeze, protect

### Comments

**Thread**:
A conversation of comments pinned to an Element or to a point on a Board.
_Avoid_: Comment (when meaning the whole conversation), discussion

**Mention**:
A reference to a Member by `@name` inside a comment, which pulls that Member into the Thread.
_Avoid_: Tag, ping

**Notification**:
A message to a User that they were mentioned, or that a Thread they're part of got a reply.
_Avoid_: Alert, activity

**Detached Thread**:
A Thread whose Element does not currently exist on the Board. It reattaches if the Element comes back.
_Avoid_: Orphaned thread, deleted thread
