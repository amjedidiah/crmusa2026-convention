# CRM USA National Convention 2026 — v1

Official convention website for Charismatic Renewal Ministries USA.

**Event:** July 29 – August 2, 2026
**Venue:** Holiday Inn NW Houston, 3539 N Sam Houston Pkwy West, Houston, TX 77086

---

## Quick Deploy

```bash
bash deploy_v1.sh
```

The script will:
1. Prompt for your Supabase anon key and PayPal Client ID and patch them in
2. Confirm Supabase migration has been run
3. Initialise git, connect to GitHub, commit and push
4. Vercel auto-deploys from the GitHub push

---

## Manual Key Locations

| Key | Where to find it |
|-----|-----------------|
| Supabase Anon Key | Supabase → Project Settings → API → `anon public` |
| PayPal Client ID  | developer.paypal.com → My Apps & Credentials → Live |

---

## Stack

- `index.html` — single-file static site (HTML/CSS/JS)
- `vercel.json` — Vercel routing config
- `supabase_migration.sql` — creates `registrations` table with RLS
- `deploy_v1.sh` — one-command deploy script

---

## Supabase Table: `registrations`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | auto |
| created_at | timestamptz | auto |
| paypal_order_id | text | PayPal transaction ID |
| first_name | text | |
| last_name | text | |
| email | text | |
| phone | text | |
| church | text | |
| city | text | |
| tier | text | earlybird / regular / late |
| total_amount | numeric | USD |
| attendees | jsonb | array of {name, age} |
| status | text | confirmed |

---

## URLs

- **Live site:** https://crmusa2026-convention.vercel.app
- **GitHub:** https://github.com/oxofoegbu/crmusa2026-convention
- **Supabase:** https://aoefpiovjcmsszxcbffi.supabase.co
