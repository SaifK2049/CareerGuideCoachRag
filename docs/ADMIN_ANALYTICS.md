# Admin analytics operations

The admin screen is served at `/admin`. It uses the normal Masari email/password session, but the `admin-analytics` Edge Function authorizes access from the current Supabase Auth user on every request.

## Grant access

Use the Supabase Dashboard user-management screen or a trusted server-side script with a secret/service-role key to set protected app metadata on the selected user:

```js
await supabase.auth.admin.updateUserById(userId, {
  app_metadata: { role: "admin" },
});
```

Never place the secret/service-role key in browser code or `config.js`. Do not use user metadata for this role. Remove the `role` value to revoke access; the server re-reads the current Auth user rather than trusting a browser-supplied role.

## Deployment order

1. Apply the database migrations and confirm the `masari-prune-analytics` Cron job is active.
2. Deploy the telemetry-enabled Edge Functions and `admin-analytics`.
3. Deploy the Cloudflare Pages bundle.
4. Grant the first administrator role and verify `/admin` with both an admin and an ordinary account.

The screen is read-only. Account changes, entitlement changes, feedback workflow state, and role administration remain outside the application.
