# Masari production launch plan

## Context

Masari is a private, multi-user career intelligence application. Visitors must authenticate before seeing application data. New users complete a three-step setup, then receive an account-isolated dashboard for their CV, job paths, evidence, progress, and AI analysis.

The production stack is:

- Cloudflare Pages: static frontend, HTTPS, custom domain, deployment previews and security headers.
- Supabase: authentication, PostgreSQL, row-level security, private CV storage, vector retrieval and Edge Functions.
- Stripe Billing: recurring Premium subscriptions, Checkout, webhook reconciliation and customer portal.
- OpenAI: embeddings and structured career analysis, called only from an authenticated Edge Function.

Assumptions:

- One Premium monthly or annual Stripe Price is launched first.
- Premium is individual rather than team-based.
- Free users receive one job path, five job descriptions, ten evidence records and two AI analyses per month.
- Premium users receive ten paths, 100 job descriptions, 250 evidence records and 50 AI analyses per month.

## What the owner must do

All application code, database definitions and deployment packaging live in this repository. The remaining work requires owner accounts, legal/business choices or secret values and therefore cannot be automated safely.

### 1. Business and legal

- Choose the company/legal seller name.
- Choose Premium monthly and annual prices and supported currencies.
- Publish Terms of Service, Privacy Policy, cancellation terms and support contact details.
- Decide whether Stripe Tax is required for the countries where subscriptions will be sold.
- Define the refund policy and support process.

### 2. Supabase production project

1. Create a paid production project in the desired data region.
2. Record the project reference, project URL and publishable key.
3. Enable email/password authentication.
4. Configure a production SMTP provider; do not launch using the shared default email sender.
5. Set:
   - Site URL: `https://app.YOUR_DOMAIN`
   - Redirect URL: `https://app.YOUR_DOMAIN/**`
   - Preview redirect URLs only for trusted test branches.
6. Enable leaked-password protection and appropriate authentication rate limits.
7. In Cloudflare Turnstile, create separate production and staging widgets for their exact hostnames. Copy the public site key to Cloudflare Pages as `PUBLIC_TURNSTILE_SITE_KEY`.
8. In Supabase Authentication → Bot and Abuse Protection, enable Cloudflare Turnstile and paste only the Turnstile secret key. Supabase validates the browser token server-side; never put this secret in Pages or `config.js`.
9. Link and deploy:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy analyze-career
   npx supabase functions deploy create-checkout-session
   npx supabase functions deploy create-portal-session
   npx supabase functions deploy stripe-webhook
   npx supabase functions deploy delete-account
   ```

10. Run database security and performance advisors and resolve every error before launch.
11. Enable point-in-time recovery or confirm the project backup/restore policy.

### 3. Stripe

1. Complete Stripe business verification.
2. Create a `Masari Premium` Product.
3. Create the recurring Price or Prices.
4. Configure the Stripe customer portal:
   - customers may update payment methods;
   - customers may download invoices;
   - customers may cancel at period end;
   - downgrade behavior is defined;
   - business, support, Terms and Privacy links are present.
5. Add this webhook endpoint:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
   ```

6. Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. Copy the webhook signing secret.
8. Keep Stripe in sandbox mode until every payment test below passes.

### 4. Server secrets

Set these in Supabase Edge Function Secrets. Never put them in Cloudflare Pages, `config.js`, Git or the browser:

```bash
npx supabase secrets set OPENAI_API_KEY=...
npx supabase secrets set OPENAI_MODEL=gpt-5-mini
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_...
npx supabase secrets set STRIPE_PREMIUM_PRICE_ID=price_...
npx supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
npx supabase secrets set APP_URL=https://app.YOUR_DOMAIN
npx supabase secrets set ALLOWED_ORIGINS=https://app.YOUR_DOMAIN
```

### 5. Cloudflare Pages

1. Put this repository in GitHub or GitLab.
2. Create a Cloudflare Pages project from the repository.
3. Configure:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 20 or newer
4. Add these non-secret build variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `PUBLIC_TURNSTILE_SITE_KEY`
   - `PUBLIC_TERMS_URL`
   - `PUBLIC_PRIVACY_URL`
5. Add `app.YOUR_DOMAIN` as the production custom domain.
6. Point DNS to Cloudflare as instructed in the Pages dashboard.
7. Verify `_headers` is active on the deployed response.
8. If a branded Supabase API domain is later used, add it to `connect-src` in `_headers`.

## 12-step delivery and verification plan

1. **Problem and success criteria — Owner**
   - Approve plan limits, pricing, policies and target launch region.
   - Success: a new customer can subscribe, use Premium, cancel and retain access only through the paid period.

2. **Actors and workflows — Product**
   - Actors: visitor, Free user, Premium user, owner/admin, Stripe, Supabase and OpenAI.
   - Test sign-up, confirmation, onboarding, sign-in, password reset, upgrade, portal, cancellation and deletion.

3. **Domain model — Engineering**
   - `career_profiles`, `career_paths`, `job_descriptions`, `knowledge_evidence`, `account_subscriptions`, `billing_customers`, `feature_usage_monthly` and `stripe_events`.
   - Invariant: every private career row belongs to one authenticated user.

4. **Backend contract — Engineering**
   - Authenticated functions: analysis, Checkout, portal and account deletion.
   - Public function: Stripe webhook with signature verification.
   - Test invalid tokens, malformed documents, repeated events and unavailable providers.

5. **Persistence — Engineering/Owner**
   - Apply migrations, RLS policies, storage policies, uniqueness constraints and quota triggers.
   - Test two users cannot read, update, delete or reference each other's records or CVs.

6. **Authentication and authorization — Owner/Engineering**
   - Configure SMTP, confirmation URLs, CAPTCHA and password policy.
   - Test expired sessions, logout, password recovery and deleted accounts.

7. **External integrations — Owner**
   - Configure Stripe, OpenAI and production secrets.
   - Test Stripe webhook signatures and OpenAI failures without leaking prompts or CV content into logs.

8. **Asynchronous processing — Engineering**
   - Current AI requests are synchronous and bounded to 250 chunks.
   - Move large ingestion or batch embedding to a queue before increasing those limits.

9. **Infrastructure and deployment — Owner**
   - Use separate Supabase projects and Stripe sandboxes for staging and production.
   - Require a successful preview deployment before production promotion.

10. **Operations — Owner**
    - Monitor failed Edge Functions, failed Stripe events, AI costs, storage, authentication abuse and database capacity.
    - Create alerts and a written payment/access incident runbook.

11. **Testing — Engineering/Owner**
    - Run `npm run check`, `npm run test:integration`, a clean local migration reset, Edge Function type checks and database advisors.
    - Complete the launch acceptance checklist below using Stripe sandbox and two independent test accounts.

12. **Launch and rollback — Owner**
    - Invite a small beta group first.
    - Keep Stripe live mode disabled until acceptance passes.
    - Roll back the Cloudflare deployment independently of database migrations; never reverse a destructive migration without a tested restore.

## Launch acceptance checklist

- [ ] Unauthenticated visitors see only the login/create-account screen.
- [ ] Email confirmation and password reset links return to the production domain.
- [ ] Turnstile blocks automated sign-in, sign-up and password-reset requests on production and staging hostnames.
- [ ] First login requires all three onboarding steps.
- [ ] Two users see only their own CV, paths, jobs, evidence, progress and usage.
- [ ] CV objects cannot be listed or downloaded by another user.
- [ ] Free path, job, evidence and AI limits are rejected by the server.
- [ ] Stripe sandbox Checkout activates Premium after the signed webhook.
- [ ] Replaying the same Stripe event does not duplicate or corrupt state.
- [ ] Premium limits appear immediately or after a safe refresh.
- [ ] Failed and past-due subscriptions do not receive Premium entitlements.
- [ ] Cancel-at-period-end retains access until the paid period ends.
- [ ] The customer portal can update payment details, download invoices and cancel.
- [ ] Account deletion cancels Stripe billing before deleting private data.
- [ ] Export produces a valid portable JSON backup.
- [ ] Cloudflare responses include CSP, HSTS, frame, content-type and referrer headers.
- [ ] Supabase security and performance advisors have no unresolved errors.
- [ ] Database restore procedure has been tested in staging.

## Operational risks

- AI requests can exceed subscription revenue without hard quotas; quotas are enforced in PostgreSQL and must be reviewed against actual usage cost.
- Stripe webhooks are asynchronous; access changes may take several seconds and events must remain idempotent.
- Client-side PDF extraction can fail for scanned/image-only PDFs; OCR needs a separate queued service.
- Supabase Edge Functions are suitable for short AI orchestration, not large batch processing.
- Legal requirements for tax, cancellation, privacy and AI processing vary by selling location and require owner review.

## Decisions that remain open

- Premium monthly and annual price.
- Free/Premium quota numbers after beta usage data.
- Trial duration, if any.
- Countries supported at launch and whether Stripe Tax is enabled.
- Support email and refund policy.
