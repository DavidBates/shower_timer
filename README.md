# Shower Timer Tracker

Shared shower timer board for camp workgroups. The primary screen keeps the
card-based timer flow, while the admin view summarizes workgroup progress and
participant counts.

## Features

- 6-minute default timer cards, with add/remove and reset-to-1-6 controls.
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

The database schema is captured in
`supabase/migrations/20260623130000_create_shower_tracking.sql`.

The app uses a publishable Supabase browser key. For a different project, set:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```
