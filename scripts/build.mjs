import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const publishableKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const turnstileSiteKey = process.env.PUBLIC_TURNSTILE_SITE_KEY;
const termsUrl = process.env.PUBLIC_TERMS_URL;
const privacyUrl = process.env.PUBLIC_PRIVACY_URL;

if (!supabaseUrl || !publishableKey || !turnstileSiteKey || !termsUrl || !privacyUrl) {
  throw new Error("Supabase configuration, PUBLIC_TURNSTILE_SITE_KEY, PUBLIC_TERMS_URL and PUBLIC_PRIVACY_URL are required");
}
if (!/^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl)) {
  throw new Error("PUBLIC_SUPABASE_URL must be an HTTPS origin without a path");
}
for (const [name, value] of [["PUBLIC_TERMS_URL", termsUrl], ["PUBLIC_PRIVACY_URL", privacyUrl]]) {
  if (!/^https:\/\/[^\s]+$/i.test(value)) throw new Error(`${name} must be an HTTPS URL`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css", "_headers", "_redirects"]) {
  await cp(resolve(root, file), resolve(output, file));
}
await writeFile(
  resolve(output, "config.js"),
  `window.CAREER_RAG_CONFIG=${JSON.stringify({
    supabaseUrl,
    supabasePublishableKey: publishableKey,
    turnstileSiteKey,
    termsUrl,
    privacyUrl,
    localPreview: false,
  })};\n`,
  "utf8",
);
console.log("Masari production bundle created in dist/");
