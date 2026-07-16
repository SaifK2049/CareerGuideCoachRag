# Masari

A private career intelligence workspace with an optional local preview mode.

- uploading a CV as a PDF and extracting its text in the browser;
- creating separate target job paths;
- collecting job descriptions as entries;
- adding explicit knowledge evidence;
- measuring recurring job-skill demand against CV and knowledge evidence;
- exporting normalized, overlapping text chunks as RAG-ready JSON.

## Run

From this folder:

\`\`\`bash
python3 -m http.server 4173
\`\`\`

Open http://127.0.0.1:4173.

Without cloud configuration the app remains a browser-only preview. With Supabase configured, users receive private account-scoped PostgreSQL storage, private CV file storage, and citation-based RAG analysis.

## Hosted setup

1. Create a Supabase project.
2. Copy `config.example.js` to `config.js` and add the project URL and publishable key. Never place a secret or service-role key in this file.
3. Link the local Supabase folder to the project and apply the migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. Store the OpenAI key as an Edge Function secret and deploy the function:

   ```bash
   npx supabase secrets set OPENAI_API_KEY=YOUR_KEY
   npx supabase functions deploy analyze-career
   npx supabase functions deploy delete-account
   ```

5. Configure the hosted site URL and allowed redirect URLs in Supabase Authentication, then deploy these static files.

The migration enables row-level security on every exposed table. All policies bind records to the authenticated user. CV PDFs are stored under a user-owned path in the private `private-cvs` bucket. The OpenAI key is read only by the Edge Function.

## Deploy

The frontend remains a static site and can be deployed to Vercel, Netlify, GitHub Pages, or an object-storage website bucket. No build step is required.

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
