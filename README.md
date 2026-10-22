# VENPURA Cricket Club

A mobile-first, installable web app for managing the VENPURA squad on Android, iPhone, and desktop. The application and deployment stack use open-source tools: Node.js, Docker Compose, and Caddy. The app does not require a paid JavaScript library or managed application platform.

## Put VENPURA on the internet

The app can be shared at a public HTTPS link using **Render for hosting** and **Supabase for the PostgreSQL database**. Both are hosted services, not open-source software themselves; the application, Node.js, and PostgreSQL are open source. This repository includes a Render blueprint and the database schema.

### What you need

- A GitHub repository containing this project. (GitHub is not open source, but its public repository option is free. A private repository is also possible.)
- A Supabase account and project. The Supabase free plan is useful for a small team; it currently includes a 500 MB database but may pause the project after seven days of inactivity.
- A Render account. Its free web service provides a shareable `onrender.com` URL, but it sleeps after about 15 minutes idle and can take around a minute to wake. It has no persistent local disk; team records therefore live in Supabase instead.
- No SMS gateway. Members create accounts with usernames and passwords; set the administrator credentials as private Render environment variables.

The free hosting tiers can sleep or pause and are intended for a small team/demo, not guaranteed always-on production service. Current provider limits can change. No accounts or repository have been connected, so **the app is not live yet and has no public URL**.

### Create your shareable link

1. Create a free GitHub repository, then upload/push this app’s project files. Do **not** include `data/`, `.env`, passwords, or Supabase service-role keys. The existing workspace itself does not have a Git remote.
2. Create a Supabase project. Open **SQL Editor**, paste and run [`supabase/schema.sql`](./supabase/schema.sql). In **Project Settings → API**, copy the project URL and the server-only `service_role` key. Do not use the `service_role` key in any browser code or commit it.
3. In Render, create a **Blueprint** and connect the GitHub repository containing this project. Render detects [`render.yaml`](./render.yaml) and creates the free Docker web service. Its Environment settings will ask for:

   - `VENPURA_ADMIN_USERNAME`: choose the captain’s username.
   - `VENPURA_ADMIN_PASSWORD`: set a unique, strong password of at least 12 characters.
   - `SUPABASE_URL`: your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: your private Supabase service-role key.

   Enter all secrets directly into the Render dashboard, never in chat or Git.
4. Deploy the Blueprint. When Render reports **Live**, copy the generated `https://venpura-cricket-club.onrender.com` (your actual name may differ) link and send it to your friends.
5. Open the HTTPS link and sign in with the configured administrator account. Admin can publish fixtures; friends create their own username/password accounts. No SMS or phone verification is used.

**Alternative:** A private Ubuntu VPS with Docker and Caddy can avoid Render's free-service sleep. It is not a free hosting guarantee: VPS, bandwidth, and possibly a domain can cost money. See [`docker-compose.yml`](./docker-compose.yml) for the self-hosted option.

When you change code, push it to GitHub; Render can rebuild from the connected repository. Supabase preserves team records independently of Render restarts and redeploys. Keep the service-role key private and keep the Supabase project's backups/data-retention options in mind.

### Local demo (optional)

Requires Node.js 20 or later. Run `npm start`, then open [http://localhost:3000](http://localhost:3000). The local demo opens the example club automatically. Use **Your name → Administrator login** to try the admin flow.

Local demo accounts:

- Sample squad member: tap **Explore demo** on the sign-in page.
- Demo administrator: tap **Admin** in the demo sign-in card.

## Included

- **Match calendar:** Saturday and Sunday club fixtures, tournament fixtures, start times, grounds, and an availability yes/no poll.
- **Wednesday cutoff:** availability closes Wednesday at 11:59 p.m. India time before each weekend fixture.
- **Player cards:** required first and last names and a choice of Bowler, Batter, All Rounder, or Wicket Keeper.
- **Squad and stats:** player roster, batting-average and wicket charts, clearly labelled sample performance figures, and admin-entered per-player match scorecards that update season totals.
- **Contributions:** a ₹30 Saturday share for each player, a player-by-player paid/pending ledger, and admin payment-recording controls. Tournament entry fees are set on the fixture and tracked by player, too.
- **Sunday match ball:** the upcoming Sunday buyer rotates alphabetically; a server-side, once-per-Monday job records an in-app reminder for that player.
- **Admin desk:** administrators can publish Saturday, Sunday, and tournament fixtures. Each team member receives a fixture notification, visible in the app and in open app tabs.
- **Progressive web app:** app manifest, installable home-screen icon, responsive mobile navigation, and a cached app shell for faster reloads.
- **Optional score feed:** an integration hook for an administrator-selected JSON cricket-score endpoint.

## Storage and access

The local demo stores club data in `data/venpura.json`, excluded from Git. In production the Node server uses Supabase PostgREST and the database function in [`supabase/schema.sql`](./supabase/schema.sql); it starts with an empty squad and creates the administrator from `VENPURA_ADMIN_USERNAME` and `VENPURA_ADMIN_PASSWORD`. The Supabase service-role key is only read by the server and its table is protected by row-level security. Revision-checked writes detect conflicting simultaneous updates instead of silently replacing another user's changes. Sessions use HTTP-only, same-site secure cookies over HTTPS; users sign in again after a hosting restart.

The “Pay” button records a payment in the demo ledger only. It does **not** collect money or initiate UPI, card, or bank transactions.

## Passwords, push, and score feeds

Accounts use usernames and passwords, protected with salted scrypt password hashes. Passwords are not stored in plaintext. Production administrator credentials come from `VENPURA_ADMIN_USERNAME` and `VENPURA_ADMIN_PASSWORD`; ordinary members register through the app. The server rate-limits repeated failed login attempts. Because there is no OTP/phone verification, an administrator should share the club URL and membership expectations only with intended players.

Fixture and ball-duty alerts are persisted in the app inbox and appear in an open client after its next refresh (within 30 seconds). Browser notifications may appear while the app is open if permission has already been granted. Offline, background, and lock-screen delivery requires a Web Push provider and VAPID keys; this project does not claim to send push messages when the server or app is offline.

No verified public Cricket Heroes API is bundled or assumed. The scorecard route is disabled until an administrator configures `CRICKET_API_URL` and, if required, `CRICKET_API_KEY`. This integration hook requests that JSON endpoint and reports provider errors; connect a provider that actually exposes the requested fixtures and that is licensed for your use. Never commit API credentials.

## Useful next modules

1. Record actual scorecards, innings, overs, partnerships, and match-by-match player statistics.
2. Add opt-in Web Push with VAPID keys for background notification delivery.
3. Add UPI payment references and reconciled receipts rather than treating a manual mark as payment.
4. Add grounds, rain cancellations, attendance-based XI suggestions, and tournament standings.
5. Add exportable team accounts and cloud database backups before hosting for a larger group.

## Checks

```sh
npm test
```

Docker is not installed in the coding workspace, so the container hasn't been built here. The cloud deployment needs the real GitHub repository, Supabase project, and Render account to produce its public URL.
