import { createClient } from "npm:@supabase/supabase-js@2.52.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response('{"error":"Method not allowed"}', { status: 405, headers });
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const body = await request.json();
    if (!token || body.confirmation !== "DELETE") {
      return new Response('{"error":"Explicit confirmation required"}', { status: 400, headers });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error: userError } = await admin.auth.getUser(token);
    if (userError || !data.user) return new Response('{"error":"Invalid session"}', { status: 401, headers });

    await admin.storage.from("private-cvs").remove(
      (await admin.storage.from("private-cvs").list(data.user.id)).data?.map((file) => `${data.user.id}/${file.name}`) || [],
    );
    await admin.auth.admin.signOut(token, "global");
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) throw deleteError;
    return new Response('{"deleted":true}', { headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Deletion failed" }), { status: 500, headers });
  }
});
