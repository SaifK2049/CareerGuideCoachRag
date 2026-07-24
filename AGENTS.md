# Repository Guidelines

## Project Structure & Module Organization

Orynta is a static browser application with a Supabase backend. The main UI lives in `index.html`, `app.js`, and `styles.css`; shared-report behavior is split into `report.html` and `report.js`. Static images belong in `assets/`. Supabase Edge Functions are under `supabase/functions/<function-name>/index.ts`, with reusable server helpers in `supabase/functions/_shared/`. Database changes are timestamped SQL files in `supabase/migrations/`. Operational runbooks live in `docs/`, while build and verification utilities live in `scripts/`. Generated output is written to `dist/` and should not be edited directly.

## Build, Test, and Development Commands

- `npm install` installs the Node 20+ tooling recorded in `package-lock.json`.
- `cp config.example.js config.js` creates local browser configuration; never commit secrets.
- `python3 -m http.server 4173` serves the application locally.
- `npm run check` syntax-checks JavaScript and runs static security and integration assertions.
- `npm run build` creates the deployable Cloudflare Pages bundle in `dist/`.
- `npx supabase start` starts the local backend; Docker Desktop is required.
- `npm run test:integration` exercises auth, RLS, quotas, storage, billing isolation, and account deletion against local Supabase.
- `npm run monitor:production` runs the production smoke checks.

## Coding Style & Naming Conventions

Match existing formatting: two-space indentation, semicolons, double quotes in JavaScript/TypeScript, and trailing commas in multiline structures. Use `camelCase` for variables and functions, `PascalCase` for types, and kebab-case for Edge Function directories. Name migrations `YYYYMMDDHHMMSS_descriptive_snake_case.sql`. Keep browser code dependency-light and extract repeated server behavior into `_shared`. No formatter is enforced, so keep diffs focused and follow neighboring code.

## Testing Guidelines

Run `npm run check` for every change. For migrations or Edge Functions, reset the local database with `npx supabase db reset --local --no-seed --yes`, then run `npm run test:integration`. Extend `scripts/verify-static.mjs` for structural or security invariants and `scripts/integration-test.mjs` for end-to-end behavior. Tests must clean up created users and remain tenant-isolated.

## Commit & Pull Request Guidelines

Recent commits follow Conventional Commits, for example `feat: improve workspace navigation` or `feat(interview-prep): add gamification`. Use an imperative, concise subject and an optional scope. Pull requests should explain user impact, list verification commands, link the relevant issue or work item, and include screenshots for visible UI changes. Call out migrations, new environment variables, security implications, and deployment steps explicitly.

## Security & Configuration

Only public values belong in `config.js`. Store OpenAI, Stripe, Turnstile, and service-role secrets with Supabase secrets. Preserve RLS, origin allowlists, rate limiting, and privacy-safe logging when changing backend behavior.
