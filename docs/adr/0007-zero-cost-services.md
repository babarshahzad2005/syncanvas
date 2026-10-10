# Run on free tiers with no payment method: Workers KV for images, Brevo for email, workers.dev hosting

v1 must run without giving any service a payment method. Cloudflare R2 requires a card even for its free tier, so images and thumbnails go in **Workers KV**. KV is free with 1 GB of storage, values up to 25 MB, and 1,000 writes per day. Uploads go through our Worker rather than presigned URLs, and assets are served from our own origin. That keeps exports free of cross-origin canvas tainting. KV can take up to about 60 seconds to show a new value in other regions, so collaborators see a retrying placeholder in the meantime. Because of the daily write limit, thumbnails are written at most once per Board every 10 minutes, and the cap's static fallback image lives in the board room's own storage, not in KV. Quotas shrink to 5 MB per image and 50 MB per User.

Resend can only email other people from a verified domain, and a domain costs money. Email therefore goes through **Brevo**: free, 300 emails per day, sent from a single verified address. Without a domain of our own, these emails may land in spam, so Google sign-in is the main way in and email links are the backup. The app is hosted at the free `*.workers.dev` URL.

Moving back to R2, Resend, or a custom domain later is a configuration and adapter change, not a rewrite.
