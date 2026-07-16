# Masari

A private, multi-user career intelligence workspace with onboarding and recurring Premium subscriptions.

- uploading a CV as a PDF and extracting its text in the browser;
- creating separate target job paths;
- collecting job descriptions as entries;
- adding explicit knowledge evidence;
- measuring recurring job-skill demand against CV and knowledge evidence;
- exporting normalized, overlapping text chunks as RAG-ready JSON.

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

4. Store server secrets and deploy the functions:

   ```bash
   npx supabase secrets set OPENAI_API_KEY=YOUR_KEY
   npx supabase secrets set STRIPE_SECRET_KEY=YOUR_STRIPE_KEY
   npx supabase secrets set STRIPE_PREMIUM_PRICE_ID=YOUR_PRICE_ID
   npx supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=YOUR_WEBHOOK_SECRET
   npx supabase secrets set APP_URL=https://app.example.com
   npx supabase secrets set ALLOWED_ORIGINS=https://app.example.com
   npx supabase functions deploy analyze-career
   npx supabase functions deploy create-checkout-session
   npx supabase functions deploy create-portal-session
   npx supabase functions deploy stripe-webhook
   npx supabase functions deploy delete-account
   ```

5. Configure the hosted site URL and allowed redirect URLs in Supabase Authentication. Create a Cloudflare Turnstile widget for the hostname, enable Turnstile in Supabase Bot and Abuse Protection with its secret key, then deploy these static files.

The migration enables row-level security on every exposed table. All policies bind records to the authenticated user. CV PDFs are stored under a user-owned path in the private `private-cvs` bucket. The OpenAI key is read only by the Edge Function.

## Verify locally

With Docker Desktop running:

```bash
npx supabase start
npx supabase db reset --local --no-seed --yes
npm run check
npm run test:integration
npx supabase db advisors --local --type all --level info --fail-on warn
```

The integration suite creates temporary authenticated users and verifies onboarding defaults, RLS isolation, cross-tenant rejection, Free and Premium limits, atomic AI quotas, Stripe event ordering, private CV storage, and safe server-function failures. Test users are deleted afterward.

## Deploy to Cloudflare Pages

Configure the Pages build command as `npm run build`, the output directory as `dist`, and add:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `PUBLIC_TERMS_URL`
- `PUBLIC_PRIVACY_URL`

The build generates browser-safe configuration and copies Cloudflare security headers into the production bundle.

See [docs/PRODUCTION_LAUNCH.md](docs/PRODUCTION_LAUNCH.md) for the complete owner checklist, Stripe setup, architecture, test gates and rollout plan.

## RAG handoff

Use Export RAG JSON to download `masari-knowledge.json`. Each document includes:

- source_type: cv, knowledge, or job_description;
- text: a normalized chunk with modest overlap;
- metadata: path, target role, company, job title, source URL, skill, or confidence.

The hosted analysis function embeds these chunks with `text-embedding-3-small`, persists them in private pgvector-backed storage, retrieves the most relevant chunks, and returns structured skill findings with source labels such as `D1` and `D4`.

## Delete and backup

- **Backup:** use **Export RAG JSON** for a portable knowledge export.
- **Workspace delete:** **Clear workspace data** deletes the signed-in user's career records on the next cloud sync.
- **Account deletion:** **Delete account permanently** calls an authenticated server function that removes private CV files, revokes sessions, and deletes the user; database records cascade automatically.
