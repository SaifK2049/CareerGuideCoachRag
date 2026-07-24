# Admin analytics operations

The admin screen is served at `/admin`. It uses the normal Orynta email/password session, but the `admin-analytics` Edge Function authorizes access from the current Supabase Auth user on every request.

## Grant access

Use the Supabase Dashboard user-management screen or a trusted server-side script with a secret/service-role key to set protected app metadata on the selected user:

```js
await supabase.auth.admin.updateUserById(userId, {
  app_metadata: { role: "admin" },
});
```

Never place the secret/service-role key in browser code or `config.js`. Do not use user metadata for this role. Remove the `role` value to revoke access; the server re-reads the current Auth user rather than trusting a browser-supplied role.

## Deployment order

1. Apply the database migrations and confirm the `orynta-prune-analytics` Cron job is active.
2. Deploy the telemetry-enabled Edge Functions and `admin-analytics`.
3. Configure `APP_URL` as the public Orynta origin and add that origin to the Supabase Auth redirect allow list. Waitlist invitations use it for the account-setup redirect.
4. Configure production SMTP and verify the Supabase Auth invite email template before sending live invitations.
5. Deploy the static application bundle.
6. Grant the first administrator role and verify `/admin` with both an admin and an ordinary account.

Analytics, user data, and feedback remain read-only. The Waitlist section is the sole operational action: an administrator can send or retry a Supabase Auth invitation. Each attempt is rate-limited, claimed atomically, and recorded as pending, invited, failed, or joined. Account changes, entitlement changes, feedback workflow state, and role administration remain outside the application.
