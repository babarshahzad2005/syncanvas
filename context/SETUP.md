# Setup guide (free, no payment method)

Everything Syncanvas needs to run your own copy, in the order you'll need it. Every service is on a free tier, and none of them should ask for a card ([ADR 0007](../docs/adr/0007-zero-cost-services.md)). **If any screen asks for a payment method, skip it. Nothing here needs one.**

Keep passwords, API keys, and connection strings out of the repository: they go into `apps/web/.env` and `apps/worker/.dev.vars` (both ignored by git), or into `wrangler secret put` for production.

## 1. Neon (Postgres)

1. Sign up at **neon.com** and create a project named `syncanvas` in the region closest to you.
2. Create a second branch named `dev` for local work; the default branch is production.
3. Copy the `dev` branch's **connection string** (it starts with `postgresql://`) into `apps/web/.env`, following `apps/web/.env.example`.

## 2. Cloudflare

1. Create an account at **dash.cloudflare.com/sign-up** and verify your email. Skip any plan or domain prompts.
2. Open **Workers & Pages** once, so your free `*.workers.dev` subdomain is created.
3. Don't open R2: it asks for a card, and Syncanvas uses Workers KV instead.
4. Run `pnpm wrangler login` and approve in the browser.
5. Create the Hyperdrive config (pointing at the Neon production branch) and a KV namespace with Wrangler, and put their IDs in `apps/worker/wrangler.jsonc`.

## 3. Local secrets

```sh
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @syncanvas/worker gen:secret   # the sign-in secret (never printed)
pnpm --filter @syncanvas/worker gen:keys     # the board-token key pair (never printed)
pnpm --filter @syncanvas/worker db:migrate   # create the tables on the dev branch
pnpm dev                                     # http://localhost:5173
```

Locally, sign-in links are printed in the terminal instead of emailed.

## 4. Email (Brevo)

1. Sign up at **brevo.com** (free plan).
2. Under **Senders**, add and verify the address emails should come from.
3. Under **SMTP & API**, generate an API key, and put it and the sender address in `.dev.vars` (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`).

Without your own domain, emails sent this way may land in spam.

## 5. Production

1. Deploy once with `pnpm release`.
2. Set the production secrets, one at a time, with `pnpm wrangler secret put NAME`: `BETTER_AUTH_SECRET`, `BOARD_TOKEN_PRIVATE_KEY`, `BOARD_TOKEN_PUBLIC_KEY`, `BREVO_API_KEY`, and `BREVO_SENDER_EMAIL`. Generate fresh values for production; don't reuse the local ones.
3. Apply migrations to the production branch: `DATABASE_URL=<production string> pnpm --filter @syncanvas/worker db:migrate`.

## 6. Continuous deployment (GitHub Actions)

Create an environment named `production` (**Settings → Environments**); the deploy job runs in it. Then add these under **Settings → Secrets and variables → Actions**:

| Name | Kind | Where it comes from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `NEON_API_KEY` | Secret | Neon → Account settings → API keys |
| `PRODUCTION_DATABASE_URL` | Secret | The Neon production branch's connection string |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare dashboard, Workers & Pages overview |
| `NEON_PROJECT_ID` | Variable | Neon → Project settings |

Then pull requests run the checks, the `full-e2e` label runs the browser suite on a throwaway Neon branch, and merging to `main` migrates production and deploys.

## Free-tier limits to keep in mind

| Service | Limit | What it affects |
|---|---|---|
| Workers | 100k requests/day | Normal use is far below this |
| Durable Objects | 100k requests/day, a daily rows-read allowance | Run load tests against a local build, never production ([`docs/benchmarks.md`](../docs/benchmarks.md)) |
| Hyperdrive | 100k queries/day | Normal use is far below this |
| Workers KV | 1 GB, 1,000 writes/day | Image quotas (5 MB per image, 50 MB per User) and thumbnails at most every 10 minutes per Board |
| Neon | 0.5 GB, 10 branches | One branch per pull request under test; CI deletes it when the pull request closes |
| Brevo | 300 emails/day | Invitations, sign-in links, and digests |
