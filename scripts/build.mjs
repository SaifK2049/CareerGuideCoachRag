import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const publishableKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const turnstileSiteKey = process.env.PUBLIC_TURNSTILE_SITE_KEY;
const termsUrl = process.env.PUBLIC_TERMS_URL || "/beta-terms.html";
const privacyUrl = process.env.PUBLIC_PRIVACY_URL || "/privacy.html";
const betaMode = process.env.PUBLIC_BETA_MODE !== "false";
const billingEnabled = process.env.PUBLIC_BILLING_ENABLED === "true";
const signupEnabled = process.env.PUBLIC_SIGNUP_ENABLED === "true";
const feedbackEnabled = process.env.PUBLIC_FEEDBACK_ENABLED !== "false";
const appVersion = (process.env.CF_PAGES_COMMIT_SHA || process.env.PUBLIC_APP_VERSION || "local").slice(0, 12);

if (!supabaseUrl || !publishableKey || !turnstileSiteKey) {
  throw new Error("Supabase configuration and PUBLIC_TURNSTILE_SITE_KEY are required");
}
if (!/^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl)) {
  throw new Error("PUBLIC_SUPABASE_URL must be an HTTPS origin without a path");
}
for (const [name, value] of [["PUBLIC_TERMS_URL", termsUrl], ["PUBLIC_PRIVACY_URL", privacyUrl]]) {
  if (!value.startsWith("/") && !/^https:\/\/[^\s]+$/i.test(value)) {
    throw new Error(`${name} must be a root-relative path or HTTPS URL`);
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css", "report.html", "report.js", "privacy.html", "beta-terms.html", "_headers", "_redirects"]) {
  await cp(resolve(root, file), resolve(output, file));
}
await writeFile(
  resolve(output, "config.js"),
  `window.CAREER_RAG_CONFIG=${JSON.stringify({
    supabaseUrl,
    supabasePublishableKey: publishableKey,
    turnstileSiteKey,
    betaMode,
    billingEnabled,
    signupEnabled,
    feedbackEnabled,
    termsUrl,
    privacyUrl,
    appVersion,
    localPreview: false,
  })};\n`,
  "utf8",
);
console.log("Masari production bundle created in dist/");
