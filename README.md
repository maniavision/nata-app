# Nata website

Marketing site for Nata, in English, French and Spanish, plus a staff area for the Nata team.
The texts are in `src/locales/` (`en.json`, `fr.json`, `es.json`), which all have the same keys.
Built with React and Vite.

## Pages

| Path | Who | What |
|---|---|---|
| `/` | Everyone | How Nata works, why it's safe, payments, FAQ |
| `/privacy-policy` | Everyone | Privacy summary |
| `/login` | Members | Phone number and password; "Set your password" sends an SMS code first |
| `/dashboard` | Staff | Users, verification, trips, transactions and revenue, filterable by year and month |
| `/feedback` | Staff | Suggestions members leave after rating a delivery |
| `/routes` | Staff | Top 10 route alerts and whether live trips cover them |

Staff are the accounts listed in `nata.admins`. Everyone else who signs in sees a "Staff only" page.

## Running it

```bash
npm install
cp .env.example .env   # then fill in the Supabase URL and anon key
npm run dev
```

`npm run build` writes the production site to `dist/`.

In development, `/dashboard/preview`, `/feedback/preview` and `/routes/preview` show the staff
pages with made-up figures and no sign-in. They are not part of the production build.

## Hosting

The site is hosted on Vercel (team `mania7`, project `nata-app`), linked to this repository: every
push to `main` deploys to production. `vercel.json` sets the Vite build and sends every page route
(`/login`, `/dashboard`…) to the app. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in the
project's Environment Variables on Vercel.

## Database

The staff pages read from Supabase through functions that refuse anyone not in `nata.admins` and
return totals only. Their SQL is in `supabase/`, applied in order:

- `20240190_web_dashboard_stats.sql` — first version of `public.dashboard_stats()`
- `20240191_dashboard_period_filter.sql` — adds the year and month filter
- `20240192_dashboard_revenue_and_routes.sql` — adds revenue and `public.top_route_alerts()`;
  US dollars count at rate 1

- `20240193_staff_only_passwords.sql` — a trigger on `auth.users` that refuses to set a password
  for any account not in `nata.admins`, so only staff can use the website's "Set your password"

The first three are applied to the live project. The feedback page uses `public.support_app_feedback`,
which comes from the app's own migrations.
