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
| `admin.html` | Admin: Overview, Team performance, Activity log, Team members, Settings |
| `team.html` | Team member: My dashboard, Log activity, My entries, Account |

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
js/dashboard.js     shared UI pieces (KPIs, funnel, targets, entry form, tables)
js/admin.js         admin page logic
js/team.js          team page logic
js/login.js         login page logic
```

## Important: where data lives

Data is saved in the **browser's localStorage**. Each browser/computer has its own copy, so team members on different machines will **not** see each other's data yet. Client-side login also isn't real security.

To use it as a real shared team tool, connect a backend (for example Supabase or Firebase). Only `js/store.js` and `js/auth.js` need to change. Until then, use **Settings → Download backup** regularly.
