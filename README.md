# Shower Timer Tracker

Shared shower timer board for camp workgroups. The primary screen keeps the
card-based timer flow, while the admin view summarizes workgroup progress and
participant counts.

## Features

- 6-minute default timer cards, with add/remove and monitor-specific reset controls.
- Monitor 1, 2, and 3 views so each screen can run its own Card 1-4 set.
- Next-kid modal with workgroup, boy/girl/adult chaperone, and minute fields.
- Supabase-backed live state so multiple devices see the same board.
- Admin stats for sessions, active showers, completed sessions, and all 26
  workgroups.
- Workgroup name editing from the admin table.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

Local dev runs at `http://localhost:3000/`.

## Supabase

The database schema is captured in `supabase/migrations/`.

The app requires Supabase configuration via environment variables:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Create a `.env` file locally or set these in your deployment environment (e.g., GitHub Actions secrets for GitHub Pages).
