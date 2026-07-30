# Public career taxonomy operations

Orynta can import the European Commission's ESCO skills and occupations export into
`career_taxonomy_nodes` and its occupation-to-skill relationships into
`career_taxonomy_edges`. The import is intentionally an operator task: taxonomy
updates are reviewed and versioned before they affect recommendations.

1. Download the current English CSV package from the official
   [ESCO download/API area](https://esco.ec.europa.eu/en/use-esco/use-esco-services-api).
2. Extract it to a temporary directory outside the repository.
3. Validate the detected files and counts without writing:

   ```sh
   npm run taxonomy:import:esco -- --dir /absolute/path/to/esco-csv --version v1.2.1 --dry-run
   ```

4. Point `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at the intended environment,
   confirm the environment explicitly, then run the same command without
   `--dry-run`.
5. Refresh a test user's Career Twin and confirm that recommendation evidence
   contains `career_taxonomy_node` references before promoting the import.

The importer is idempotent on `(taxonomy, external_id)` and preserves the source
version and URI in metadata. Do not import an unreviewed archive, and do not put a
service-role key in browser configuration or source control.
