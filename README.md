# Masari

A private, multi-user career intelligence workspace configured for a free, invitation-only beta.

- uploading a CV as a PDF and extracting its text in the browser;
- creating separate target job paths;
- collecting job descriptions as entries;
- adding explicit knowledge evidence;
- measuring recurring job-skill demand against CV and knowledge evidence;
- running saved, cited RAG analysis with idempotent quota handling;
- exporting a portable JSON copy of the account;
- submitting privacy-safe beta feedback.

Billing code is retained for a later paid launch, but signup and Premium controls are disabled during the private beta.

## Run

Copy `config.example.js` to `config.js`, add a development Supabase project, then run:

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173.

Production mode requires Supabase configuration and starts at the authentication screen. Local preview mode is available only when explicitly enabled in `config.js`.

## Hosted setup

1. Create a Supabase project.
2. Copy `config.example.js` to `config.js` and add the project URL, publishable key, and public Cloudflare Turnstile site key. Never place a secret, Turnstile secret, or service-role key in this file.
3. Link the local Supabase folder to the project and apply the migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. Store the private-beta server secrets and deploy the functions:

   ```bash
   npx supabase secrets set OPENAI_API_KEY=YOUR_KEY
   npx supabase secrets set OPENAI_MODEL=gpt-5-mini
   npx supabase secrets set APP_URL=https://app.example.com
   npx supabase secrets set ALLOWED_ORIGINS=https://app.example.com
   npx supabase functions deploy analyze-career
   npx supabase functions deploy export-account
   npx supabase functions deploy delete-account
   ```

5. Disable public signup in hosted Supabase while leaving email/password login enabled. Configure the hosted site URL, allowed redirects, custom SMTP and admin invitations. Create a Cloudflare Turnstile widget for the hostname, enable Turnstile in Supabase Bot and Abuse Protection with its secret key, then deploy the static bundle.

The migration enables row-level security on every exposed table. All policies bind records to the authenticated user. CV PDFs are stored under a user-owned path in the private `private-cvs` bucket. The OpenAI key is read only by the Edge Function.

## Rate limiting

Supabase Auth applies its own IP and endpoint limits to sign-in, sign-up, email, password-reset, verification and token-refresh requests. Masari adds an atomic PostgreSQL-backed limiter for authenticated Edge Functions:

- AI analysis: 5 requests per 5 minutes per user, in addition to the monthly plan quota.
- Stripe Checkout creation: 5 requests per 10 minutes per user.
- Stripe billing portal creation: 10 requests per 10 minutes per user.
- Account deletion: 3 attempts per hour per user.
- Account export: 5 requests per hour per user.

Exceeded requests return HTTP `429`, a `RATE_LIMITED` code and a `Retry-After` header. The limiter table is private, has explicit deny policies and can only be consumed by the service role through a locked server function.

## Verify locally

With Docker Desktop running:

```bash
npx supabase start
npx supabase db reset --local --no-seed --yes
npx supabase stop && npx supabase start
npm run check
npm run test:integration
npx supabase db advisors --local --type all --level info --fail-on warn
```

## Production monitoring

GitHub Actions runs `npm run monitor:production` every 15 minutes and can also be
started manually. It verifies that the production homepage and application script
are reachable and that the `analyze-career` CORS preflight accepts the exact
production origin, including the monitoring request header.

Analysis executions write structured, privacy-safe JSON events to Supabase Edge
Function logs. Events contain request IDs, durations, status or error codes, and
counts, but never CV text, job descriptions, email addresses, or access tokens.
Failed analyses display the first eight characters of the request ID as a support
reference that can be searched in the Supabase Logs Explorer.

The integration suite creates temporary admin-invited users and verifies disabled public signup, consent, RLS isolation, concurrent rate limiting, cross-tenant rejection, beta limits, persisted/idempotent analyses, quota refunds, feedback, account export, Stripe isolation, private CV storage, and permanent account deletion. Test users are deleted afterward.

## Deploy to Cloudflare Pages

Configure the Pages build command as `npm run build`, the output directory as `dist`, and add:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `PUBLIC_BETA_MODE=true`
- `PUBLIC_BILLING_ENABLED=false`
- `PUBLIC_SIGNUP_ENABLED=false`
- `PUBLIC_FEEDBACK_ENABLED=true`

Terms and privacy URLs are optional; the bundle defaults to the included beta pages. The build generates browser-safe configuration and copies Cloudflare security headers into the production bundle.

See [docs/PRIVATE_BETA_LAUNCH.md](docs/PRIVATE_BETA_LAUNCH.md) for the beta acceptance gate and owner-supplied configuration. [docs/PRODUCTION_LAUNCH.md](docs/PRODUCTION_LAUNCH.md) remains the later paid-launch plan.

## RAG handoff

Use **Export account data** to download `masari-account-export.json`. It includes the profile, CV text, paths, jobs, evidence, saved analyses and citations, audit events, feedback, and stored-file metadata. Original PDF bytes are not embedded in the JSON.

The hosted analysis function embeds these chunks with `text-embedding-3-small`, persists them in private pgvector-backed storage, retrieves the most relevant chunks, and returns structured skill findings with source labels such as `D1` and `D4`.

## Delete and backup

- **Backup:** use **Export account data** for a portable JSON export.
- **Workspace delete:** **Clear workspace data** removes career records, saved analyses, and stored CV files.
- **Account deletion:** **Delete account permanently** requires the current password, removes private CV files, revokes sessions, and deletes the user; database records cascade automatically.
