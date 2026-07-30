import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith("--")) {
    const [key, inline] = value.slice(2).split("=", 2);
    const next = process.argv[index + 1];
    if (inline !== undefined) args.set(key, inline);
    else if (next && !next.startsWith("--")) { args.set(key, next); index += 1; }
    else args.set(key, true);
  }
}
const sourceDir = args.get("dir") ? resolve(String(args.get("dir"))) : "";
const sourceVersion = String(args.get("version") || "v1.2.1");
const dryRun = args.has("dry-run");
if (!sourceDir) throw new Error("Usage: npm run taxonomy:import:esco -- --dir /path/to/esco-csv --version v1.2.1 [--dry-run]");

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted && character === '"' && value[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && (character === "," || character === "\n" || character === "\r")) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (character !== ",") { if (row.some((item) => item.length)) rows.push(row); row = []; }
      continue;
    }
    field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function first(row, names) {
  for (const name of names) if (row[name]) return String(row[name]).trim();
  return "";
}

function aliases(value) {
  return [...new Set(String(value || "").split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

async function findFile(files, patterns) {
  const match = files.find((file) => patterns.some((pattern) => pattern.test(file)));
  if (!match) throw new Error(`Missing ESCO file matching ${patterns.map(String).join(", ")}`);
  return resolve(sourceDir, match);
}

async function batches(values, size, callback) {
  for (let index = 0; index < values.length; index += size) await callback(values.slice(index, index + size));
}

const files = await readdir(sourceDir);
const skillFile = await findFile(files, [/skills.*en.*\.csv$/i, /^skills.*\.csv$/i]);
const occupationFile = await findFile(files, [/occupations.*en.*\.csv$/i, /^occupations.*\.csv$/i]);
const relationFile = await findFile(files, [/occupation.*skill.*relation.*\.csv$/i]);
const [skills, occupations, relations] = await Promise.all([
  readFile(skillFile, "utf8").then(parseCsv),
  readFile(occupationFile, "utf8").then(parseCsv),
  readFile(relationFile, "utf8").then(parseCsv),
]);

function node(row, nodeType) {
  const uri = first(row, ["conceptUri", "conceptURI", "uri", "concept_uri"]);
  const label = first(row, ["preferredLabel", "preferred_label", "title"]);
  if (!uri || !label) return null;
  return {
    taxonomy: "esco",
    external_id: uri,
    node_type: nodeType,
    preferred_label: label.slice(0, 240),
    description: first(row, ["description", "definition", "scopeNote"]).slice(0, 10000),
    aliases: aliases(first(row, ["altLabels", "alternativeLabels", "alt_labels"])),
    metadata: {
      source_version: sourceVersion,
      source_url: uri,
      imported_from: "European Commission ESCO CSV export",
      licence: "European Commission reuse terms; verify the downloaded package licence",
    },
    updated_at: new Date().toISOString(),
  };
}

const nodes = [
  ...skills.map((row) => node(row, "skill")),
  ...occupations.map((row) => node(row, "occupation")),
].filter(Boolean);
const nodeUris = new Set(nodes.map((item) => item.external_id));
const normalizedRelations = relations.map((row) => ({
  occupation: first(row, ["occupationUri", "occupationURI", "occupation_uri"]),
  skill: first(row, ["skillUri", "skillURI", "skill_uri"]),
  relation: first(row, ["relationType", "relation_type", "type"]),
})).filter((row) => nodeUris.has(row.occupation) && nodeUris.has(row.skill));

console.log(JSON.stringify({
  sourceVersion,
  nodes: nodes.length,
  skills: skills.length,
  occupations: occupations.length,
  relations: normalizedRelations.length,
  dryRun,
}, null, 2));
if (dryRun) process.exit(0);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
await batches(nodes, 500, async (batch) => {
  const { error } = await client.from("career_taxonomy_nodes").upsert(batch, { onConflict: "taxonomy,external_id" });
  if (error) throw error;
});

const idByUri = new Map();
await batches([...nodeUris], 200, async (uris) => {
  const { data, error } = await client.from("career_taxonomy_nodes")
    .select("id,external_id")
    .eq("taxonomy", "esco")
    .in("external_id", uris);
  if (error) throw error;
  for (const item of data || []) idByUri.set(item.external_id, item.id);
});
const edges = normalizedRelations.flatMap((relation) => {
  const occupationId = idByUri.get(relation.occupation);
  const skillId = idByUri.get(relation.skill);
  if (!occupationId || !skillId) return [];
  return [{
    from_node_id: occupationId,
    to_node_id: skillId,
    relationship: "requires",
    weight: /essential/i.test(relation.relation) ? 1 : 0.7,
    metadata: {
      source_version: sourceVersion,
      relation_type: relation.relation,
      source_url: "https://esco.ec.europa.eu/en/classification",
    },
  }];
});
await batches(edges, 500, async (batch) => {
  const { error } = await client.from("career_taxonomy_edges").upsert(batch, {
    onConflict: "from_node_id,to_node_id,relationship",
  });
  if (error) throw error;
});
console.log(`Imported ${nodes.length} ESCO nodes and ${edges.length} occupation-skill relationships.`);
