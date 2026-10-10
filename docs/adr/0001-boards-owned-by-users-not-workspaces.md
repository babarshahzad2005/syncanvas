# Boards are owned by individual Users, not workspaces

Every Board has exactly one Owner, a User. There is no Team or Workspace concept. A "team" is simply the set of Members a Board has been shared with. We chose this over lightweight workspaces because workspaces bring two levels of membership (workspace and board) and settings that pass down from one to the other. That is org administration, which v1 explicitly leaves out. Adding workspaces later means migrating ownership, so this decision is hard to reverse.
