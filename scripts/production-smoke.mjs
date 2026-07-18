const appUrl = (process.env.MONITOR_APP_URL || "https://masari-qujfb.ondigitalocean.app").replace(/\/$/, "");
const supabaseUrl = (process.env.MONITOR_SUPABASE_URL || "https://fdievvhtyllgpdoedcai.supabase.co").replace(/\/$/, "");
const timeoutMs = Number(process.env.MONITOR_TIMEOUT_MS || 15000);

async function checkedFetch(name, url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...options,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${name} returned HTTP ${response.status}`);
  }
  console.log(JSON.stringify({
    check: name,
    status: response.status,
    duration_ms: Date.now() - startedAt,
  }));
  return response;
}

const homepage = await checkedFetch("homepage", appUrl);
const homepageText = await homepage.text();
if (!homepageText.includes("Masari")) throw new Error("Homepage content marker is missing");

const appScript = await checkedFetch("application_script", `${appUrl}/app.js`);
const appScriptText = await appScript.text();
if (!appScriptText.includes('cloud.functions.invoke("analyze-career"')) {
  throw new Error("Production application script is missing the analysis integration");
}

const preflightStartedAt = Date.now();
const preflight = await fetch(`${supabaseUrl}/functions/v1/analyze-career`, {
  method: "OPTIONS",
  headers: {
    Origin: appUrl,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,apikey,content-type,x-client-info,x-request-id",
  },
  signal: AbortSignal.timeout(timeoutMs),
});
if (preflight.status !== 204) {
  throw new Error(`Analysis preflight returned HTTP ${preflight.status}`);
}
if (preflight.headers.get("access-control-allow-origin") !== appUrl) {
  throw new Error("Analysis preflight did not allow the production origin");
}
if (!(preflight.headers.get("access-control-allow-headers") || "").includes("x-request-id")) {
  throw new Error("Analysis preflight did not allow monitoring request IDs");
}
console.log(JSON.stringify({
  check: "analysis_preflight",
  status: preflight.status,
  duration_ms: Date.now() - preflightStartedAt,
}));

console.log("Production smoke monitoring passed.");
