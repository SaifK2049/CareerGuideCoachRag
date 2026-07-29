import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { seedDemo, DEMO_EMAIL } from "./demo-data.mjs";

const root = resolve(import.meta.dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.DEMO_PORT || 4173);

function localStatus() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: root, encoding: "utf8" });
  const status = JSON.parse(output.slice(output.indexOf("{")));
  const url = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("Local demo requires loopback Supabase");
  return status;
}

const status = localStatus();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function json(response, code, body) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": `http://${host}:${port}`,
  });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function demoUser(request) {
  const authorization = request.headers.authorization || "";
  const response = await fetch(`${status.API_URL}/auth/v1/user`, {
    headers: { apikey: status.ANON_KEY, Authorization: authorization },
  });
  const user = await response.json();
  if (!response.ok || user.email !== DEMO_EMAIL || user.app_metadata?.local_demo !== true) {
    throw new Error("Demo account authentication required");
  }
  return user;
}

async function service(path, options = {}) {
  const response = await fetch(status.API_URL + path, {
    method: options.method || "GET",
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

async function rerunAnalysis(request) {
  const user = await demoUser(request);
  const input = await body(request);
  const pathId = String(input.pathId || "");
  const rows = await service(`/rest/v1/career_analyses?user_id=eq.${user.id}&path_id=eq.${pathId}&status=eq.succeeded&select=*&order=created_at.desc&limit=1`);
  if (!rows[0]) throw new Error("Seeded analysis not found for this path");
  const now = new Date().toISOString();
  const analysis = {
    ...rows[0],
    id: randomUUID(),
    request_id: input.requestId || randomUUID(),
    summary: `Deterministic local rerun. ${rows[0].summary}`,
    model: "local-demo-deterministic-v1",
    created_at: now,
    started_at: now,
    completed_at: now,
    updated_at: now,
  };
  await service("/rest/v1/career_analyses", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: analysis,
  });
  return { analysis, access: { plan_code: "free", used: 2, quota: 10 } };
}

function demoHtml() {
  return readFileSync(resolve(root, "index.html"), "utf8")
    .replace(/<link rel="preconnect"[^>]+>\s*/g, "")
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>\s*/g, "")
    .replace(
      /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.110\.6\/dist\/umd\/supabase\.min\.js"[^>]*><\/script>/,
      '<script src="/__demo/vendor/supabase.js"></script>',
    )
    .replace(
      /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/pdf\.min\.js"[^>]*><\/script>/,
      '<script type="module">import * as pdfjsLib from "/__demo/vendor/pdf.mjs"; window.pdfjsLib = pdfjsLib;</script>',
    )
    .replace(/<script src="https:\/\/challenges\.cloudflare\.com\/turnstile[^>]*><\/script>/, "");
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { Allow: "GET,POST,OPTIONS" });
      return response.end();
    }
    if (url.pathname === "/config.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(`window.CAREER_RAG_CONFIG=${JSON.stringify({
        supabaseUrl: status.API_URL,
        supabasePublishableKey: status.ANON_KEY,
        turnstileSiteKey: "",
        betaMode: true,
        billingEnabled: false,
        signupEnabled: false,
        feedbackEnabled: true,
        termsUrl: "/beta-terms.html",
        privacyUrl: "/privacy.html",
        appVersion: "local-demo",
        localPreview: false,
        localDemo: true,
        localDemoApi: "/__demo",
      })};`);
    }
    if (url.pathname === "/__demo/reset" && request.method === "POST") {
      await demoUser(request);
      await seedDemo();
      return json(response, 200, { reset: true });
    }
    if (url.pathname === "/__demo/analyze" && request.method === "POST") {
      return json(response, 200, await rerunAnalysis(request));
    }
    const vendor = {
      "/__demo/vendor/supabase.js": resolve(root, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"),
      "/__demo/vendor/pdf.mjs": resolve(root, "node_modules/pdfjs-dist/build/pdf.mjs"),
      "/__demo/vendor/pdf.worker.mjs": resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
    };
    let filePath = vendor[url.pathname];
    if (!filePath) {
      const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      filePath = resolve(root, `.${requested}`);
      if (!filePath.startsWith(root) || filePath.includes("/.git/") || filePath.includes("/supabase/.temp/")) {
        return json(response, 403, { error: "Forbidden" });
      }
    }
    if (filePath === resolve(root, "index.html")) {
      response.writeHead(200, { "Content-Type": mimeTypes[".html"], "Cache-Control": "no-store" });
      return response.end(demoHtml());
    }
    if (!statSync(filePath).isFile()) return json(response, 404, { error: "Not found" });
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": filePath.includes("/__demo/") ? "no-store" : "no-cache",
    });
    response.end(readFileSync(filePath));
  } catch (error) {
    json(response, error.message === "Demo account authentication required" ? 401 : 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Orynta local demo: http://${host}:${port}`);
  console.log("Runtime integrations are local or deterministic; no production service is configured.");
});
