# Career RAG Workspace

A local-first career knowledge workspace for:

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

The current prototype stores data in localStorage. The PDF parser is loaded from PDF.js in the browser. No CV or job data is sent to an AI provider from this screen.

## Deploy

This is a static site. It can be deployed to any static host such as Vercel, Netlify, GitHub Pages, or an object-storage website bucket. No build step is required.

## RAG handoff

Use Export RAG JSON to download career-rag-knowledge.json. Each document includes:

- source_type: cv, knowledge, or job_description;
- text: a normalized chunk with modest overlap;
- metadata: path, target role, company, job title, source URL, skill, or confidence.

The next hosted layer should upload these documents to a server-side vector store. Keep the OpenAI API key on the server, then add authentication and a database before storing personal CV data outside the browser.
