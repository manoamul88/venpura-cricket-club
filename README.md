# VENPURA Cricket Club

A mobile-first, installable web app for managing the VENPURA squad on Android, iPhone, and desktop. The application and deployment stack use open-source tools: Node.js, Docker Compose, and Caddy. The app does not require a paid JavaScript library or managed application platform.

## Put VENPURA on the internet

The app can be shared at a public HTTPS link using **Render for hosting** and **Supabase for the PostgreSQL database**. Both are hosted services, not open-source software themselves; the application, Node.js, and PostgreSQL are open source. This repository includes a Render blueprint and the database schema.

### What you need

- A GitHub repository containing this project. (GitHub is not open source, but its public repository option is free. A private repository is also possible.)
- A Supabase account and project. The Supabase free plan is useful for a small team; it currently includes a 500 MB database but may pause the project after seven days of inactivity.
- A Render account. Its free web service provides a shareable `onrender.com` URL, but it sleeps after about 15 minutes idle and can take around a minute to wake. It has no persistent local disk; team records therefore live in Supabase instead.
- Members create accounts with a username, password, email address, and mobile number. Sign-up does not send OTPs.
- Email password recovery sends a one-time link through SMTP. The Blueprint is prefilled for Gmail; you must privately add the Gmail address and a Google App Password in Render before recovery emails can be sent. SMS recovery is not enabled.

The free hosting tiers can sleep or pause and are intended for a small team/demo, not guaranteed always-on production service. Current provider limits can change.

### Create your shareable link

1. This project is in the [VENPURA GitHub repository](https://github.com/manoamul88/venpura-cricket-club). Do **not** include `data/`, `.env`, passwords, or Supabase Secret keys in Git.
2. Create a Supabase project. Open **SQL Editor**, paste and run [`supabase/schema.sql`](./supabase/schema.sql). In **Project Settings → API Keys**, copy the project URL and the server-only **Secret key** (it starts with `sb_secret_`). The app supports Supabase's newer secret key and legacy `service_role` key. Never use either secret in browser code or commit it.
   For an existing deployment, run the updated schema in Supabase SQL Editor before deploying this version; it adds the private media-storage bucket without deleting club data.
3. In Render, create a **Blueprint** and connect the GitHub repository containing this project. Render detects [`render.yaml`](./render.yaml) and creates the free Docker web service. Its Environment settings will ask for:

   - `VENPURA_ADMIN_USERNAME`: choose the captain’s username.
   - `VENPURA_ADMIN_PASSWORD`: set a unique, strong password of at least 12 characters.
   - `SUPABASE_URL`: your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: your private Supabase Secret key (`sb_secret_...`) or legacy `service_role` key.
   - `SMTP_USER`: the Gmail address that will send password-reset email.
   - `SMTP_PASSWORD`: a Google App Password for that Gmail account, not its normal sign-in password.
   - `SMTP_FROM`: `VENPURA <your-email@gmail.com>` using the same Gmail address.

   Enter all secrets directly into the Render dashboard, never in chat or Git.
   To create a Google App Password, first enable 2-Step Verification on the Gmail/Google account, then open [Google App Passwords](https://myaccount.google.com/apppasswords) and create one for VENPURA. Google shows the password once; copy it directly into Render. If App Passwords are unavailable for the account, use an SMTP email provider instead and enter its SMTP settings in Render.
4. Deploy the Blueprint. When Render reports **Live**, copy the generated `https://venpura-cricket-club.onrender.com` (your actual name may differ) link and send it to your friends.
5. Open the HTTPS link and sign in with the configured administrator account. Admin can publish fixtures; friends create their own username/password accounts with their email and mobile number. **Forgot password** sends a reset link to the account email. The administrator password is changed in Render settings rather than through member recovery.

**Alternative:** A private Ubuntu VPS with Docker and Caddy can avoid Render's free-service sleep. It is not a free hosting guarantee: VPS, bandwidth, and possibly a domain can cost money. See [`docker-compose.yml`](./docker-compose.yml) for the self-hosted option.

When you change code, push it to GitHub; Render can rebuild from the connected repository. Supabase preserves team records independently of Render restarts and redeploys. Keep the service-role key private and keep the Supabase project's backups/data-retention options in mind.

### Local demo (optional)

Requires Node.js 20 or later. Run `npm start`, then open [http://localhost:3000](http://localhost:3000). The local demo opens the example club automatically. Use **Your name → Administrator login** to try the admin flow.

Local demo accounts:

- Sample squad member: tap **Explore demo** on the sign-in page.
- Demo administrator: tap **Admin** in the demo sign-in card.

## Included

- **Match calendar:** distinct Saturday match, Sunday match, and tournament fixture types, with matching date validation, start times, grounds, and an availability yes/no poll.
- **Availability poll:** players can update their Yes/No response for upcoming matches at any time; each fixture shows the names of players who answered Yes as well as the response count.
- **Player cards:** required first and last names and a choice of Bowler, Batter, All Rounder, or Wicket Keeper.
- **CricHeroes profiles and scorecards:** every player can add a CricHeroes ID or official profile link. Admins can attach the official scorecard URL to a fixture; squad members open that link from the dashboard, where mobile devices may hand it off to the CricHeroes app. Scorecard details are not embedded because CricHeroes does not publish a verified public API for this app.
- **Squad and stats:** player roster, batting-average and wicket charts, clearly labelled sample performance figures, and admin-entered per-player match scorecards that update season totals.
- **Contributions:** a ₹30 Saturday share for each player, a player-by-player paid/pending ledger, and admin payment-recording controls. Tournament entry fees are set on the fixture and tracked by player, too.
- **Sunday match ball:** admins can select a buyer while publishing a Sunday fixture, or use the alphabetical rotation. The buyer is shown in the admin desk and dashboard; a server-side, once-per-Monday job records an in-app reminder for that player.
- **Payment and ball reminders:** admins can toggle each player’s match payment between paid and unpaid. On Mondays, only players still marked unpaid for matches in the coming week receive an in-app payment reminder; the assigned Sunday ball buyer receives their ball reminder.
- **Admin desk:** administrators can publish Saturday, Sunday, and tournament fixtures. Each team member receives a fixture notification, visible in the app and in open app tabs.
- **Match memories:** signed-in players can upload match-linked photos and videos up to 50 MB. The dashboard gallery is private to squad members; players can remove their own uploads, and the admin can remove any upload.
- **Progressive web app:** app manifest, installable home-screen icon, responsive mobile navigation, and a cached app shell for faster reloads.
- **VENPURA branding:** the supplied club crest is used across the app, sign-in screen, favicon, and install icons. The interface uses the crest's navy-and-gold palette with responsive, touch-friendly layouts.
- **Optional score feed:** an integration hook for an administrator-selected JSON cricket-score endpoint.

## Storage and access

The local demo stores club data in `data/venpura.json`, excluded from Git. In production the Node server uses Supabase PostgREST and the database function in [`supabase/schema.sql`](./supabase/schema.sql); it starts with an empty squad and creates the administrator from `VENPURA_ADMIN_USERNAME` and `VENPURA_ADMIN_PASSWORD`. Match media files are stored in a private Supabase Storage bucket and streamed only through authenticated app routes; only file metadata is kept with the team state. The Supabase service-role key is only read by the server and its table is protected by row-level security. Revision-checked writes detect conflicting simultaneous updates instead of silently replacing another user's changes. Sessions use HTTP-only, same-site secure cookies over HTTPS; users sign in again after a hosting restart.

The “Pay” button records a payment in the demo ledger only. It does **not** collect money or initiate UPI, card, or bank transactions.

## Passwords, push, and score feeds

Accounts use usernames and passwords, protected with salted scrypt password hashes. Passwords are not stored in plaintext. Production administrator credentials come from `VENPURA_ADMIN_USERNAME` and `VENPURA_ADMIN_PASSWORD`; ordinary members register through the app with required email and mobile contact details. Player contact details are returned only to the signed-in player, not exposed in the squad list. Forgot-password links are single-use, expire after 30 minutes, and require SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `PUBLIC_APP_URL`). The server rate-limits repeated login and recovery requests. The admin password is managed in Render.

Fixture and ball-duty alerts are persisted in the app inbox and appear in an open client after its next refresh (within 30 seconds). Browser notifications may appear while the app is open if permission has already been granted. Offline, background, and lock-screen delivery requires a Web Push provider and VAPID keys; this project does not claim to send push messages when the server or app is offline.

No verified public CricHeroes API is bundled or assumed. Admins can add a secure `cricheroes.com` scorecard URL to a fixture so players can open its live scorecard on the official website or installed app. Score details are not scraped or embedded. An optional independent score-feed route can be configured with `CRICKET_API_URL` and, if required, `CRICKET_API_KEY`; use a provider that actually exposes the requested fixtures and is licensed for your use. Never commit API credentials.

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
