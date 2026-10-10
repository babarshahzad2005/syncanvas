# Postgres via Hyperdrive, not Cloudflare D1

Everything else runs on Cloudflare, but Users, Memberships, Threads, Notifications and the search index live in Postgres (for example Neon), reached from Workers through Hyperdrive. We chose it over D1 for mature full-text search with ranking and snippets, transactions across tables, and a standard database we won't outgrow. The cost is a second vendor and an extra network hop from Workers to the database. Board content is not affected, because it lives in each Board's own storage, not in Postgres.
