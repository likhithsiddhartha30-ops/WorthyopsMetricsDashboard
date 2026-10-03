# WorthyOps Metrics Dashboard

Outreach and sales tracking dashboard with separate **Admin** and **Team member** logins.

## Run it

```bash
node serve.js
```

Then open http://localhost:5500. You can also double-click `index.html`, but a local server is more reliable.

Default logins are in `js/config.js`. **Change the admin password in Settings after you first sign in.**

## Pages

| File | What it is |
|---|---|
| `index.html` | Portal: pick Admin or Team login |
| `admin-login.html` / `team-login.html` | The two login pages |
| `admin.html` | Admin: Overview, Team performance, Leads, Content, Activity log, Team members, Settings |
| `team.html` | Team member: My dashboard, Log activity, My leads, My entries, Account |

## Leads (client list)

Every prospect, with name, business, handle/link, email, phone, source, niche, owner, stage, deal value, amount paid, follow-ups, last contact, next follow-up and notes.

- **Stages:** New lead → Contacted → Replied → Call booked → Call attended → Converted → Paid (or Lost). These are defined in `js/config.js`.
- **Views:** a table (change the stage inline) or a drag-and-drop pipeline board.
- **Follow-ups:** due and overdue follow-ups are flagged in the sidebar and on the dashboard.
- **Import:** a CSV exported from Google Sheets (File → Download → CSV). Common column names such as "Client Name", "Instagram", "Status", "Assigned To" and "Date Contacted" are matched automatically.
- **Who sees what:** admins see every lead. Team members see only their own.
- **Lead type:** every lead is Outbound, Inbound · Organic content, or Inbound · Paid ads. Inbound leads can be linked to the post or ad that brought them in.

## Content (admin)

Tracks inbound results from **organic content** and **paid ads** separately.

- **Side-by-side comparison:** leads, meetings booked, show-ups, deals closed, revenue and cash collected for each channel. Organic also shows views and leads per 1,000 views. Paid also shows ad spend, cost per lead, cost per meeting and ROAS.
- **Charts:** inbound leads over time, revenue by source (outbound / organic / paid), and an organic-vs-paid funnel.
- **Content library:** every post or ad with its all-time results. Click one to see every lead it generated, and add new leads straight from it.

## What it tracks

Outreach sent, follow-ups, replies, calls booked, calls attended, deals converted, clients paid, revenue closed, and cash collected.

From those it works out the reply rate, booking rate, show rate, close rate, payment rate, outreach → client rate, average deal value, revenue per 100 messages, outstanding balance, and progress against monthly targets.

## Code layout

```
css/base.css        design tokens (light/dark), buttons, forms, tables, modals
css/login.css       login + portal pages
css/dashboard.css   sidebar, KPI tiles, charts, funnel, targets
js/config.js        default accounts, demo data toggle, default targets/currency
js/utils.js         formatting, dates, theme, toasts, modals
js/auth.js          password hashing, sessions, page guards
js/store.js         data layer (localStorage) - swap this for a real backend
js/metrics.js       totals, conversion rates, time buckets, per-member stats
js/charts.js        Chart.js wrappers
js/dashboard.js     shared UI pieces (KPIs, hero, funnel, targets, entry form, tables)
js/leads.js         lead list: table, pipeline board, lead form, CSV import/export
js/content.js       content section: organic vs paid, content library, per-post drill-down
js/admin.js         admin page logic
js/team.js          team page logic
js/login.js         login page logic
```

## Google Sheet sync

Leads, Content and Daily Activity sync both ways with the WorthyOps Google Sheet:

- **From the sheet:** the dashboard pulls every 60 seconds, plus on page load and when you return to the tab. Rows added by an AI outreach tool show up automatically.
- **To the sheet:** adding, editing or deleting on the dashboard writes back to the sheet within a second.

Setup:

1. Copy `google-apps-script/Code.gs` into an Apps Script project. (It already exists as "WorthyOps Sheet API".)
2. Go to **Deploy → New deployment → Web app**. Set Execute as **Me** and Who has access **Anyone**, then click **Deploy** and **Authorize**.
3. Copy the **Web app URL** (it ends in `/exec`) into **Admin → Settings → Google Sheet sync**, then click **Test & connect**. To make it the default for every browser, create `js/config.local.js`, which git ignores, containing `APP_CONFIG.sheetSync.url = '…/exec';`. That keeps the URL out of the repo.
4. Optional extra lock: set `API_KEY` in the script to any random string, redeploy, and enter the same key in Settings.

Things to know:

- **Owner and Team Member names** in the sheet must match the names of dashboard accounts to link to them.
- **Treat the web app URL like a password.** Anyone who has it can read and change the sheet.

## Important: where data lives

Data is saved in the **browser's localStorage**. Each browser/computer has its own copy, so team members on different machines will **not** see each other's data yet. Client-side login also isn't real security.

To use it as a real shared team tool, connect a backend (for example Supabase or Firebase). Only `js/store.js` and `js/auth.js` need to change. Until then, use **Settings → Download backup** regularly.
