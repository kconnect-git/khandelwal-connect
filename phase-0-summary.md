# Phase 0 — Completed

Summary of what's actually built and live, for handoff into Phase 1. See [khandelwal-connect-project-context.md](khandelwal-connect-project-context.md) for the full product/design spec this was built from.

## Supabase project

- Active project URL: `https://agxygngazgmemplcogho.supabase.co`
- Auth: Email OTP (`signInWithOtp` / `verifyOtp`), 6-digit numeric code
- Custom SMTP: Resend, sending from a verified domain (`lakshya-khandelwal.com`) — no longer on Resend's sandbox domain, so delivery works to any recipient
- Confirmed working end-to-end: sign up → receive code → verify → row created in `people`
- **Not yet re-verified on this project**: the rest of the Section 6 schema (`businesses`, `events`, `rsvps`, `matrimony_profiles`, `matrimony_interests`, `dues`, `admin_audit_log`), their RLS policies, and the 4 storage buckets from Section 7. Only `people` + its self-insert RLS policy has been exercised so far. Confirm these exist on this project before starting Phase 1's family-tree work.

## Member app (`member-app/`)

- Vite + React + TypeScript
- Tailwind CSS v4 (`@tailwindcss/vite`), design tokens defined via `@theme` in `src/index.css` — dark vermilion palette (`--color-accent: #FF4D2E`, near-black surfaces), with a light-mode override block keyed off `[data-theme="light"]`
- Light/dark toggle: `src/context/ThemeContext.tsx`, persists choice to `localStorage`, defaults to dark
- Fonts: Archivo (headings) + Hanken Grotesk (body) via Google Fonts CDN, linked in `index.html`
- Routing: `react-router-dom` — `/` (session-aware redirect), `/signup`, `/verify`, `/dashboard`
- Supabase client: `src/utils/supabase.ts`, reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` from env

## Auth flow

- `src/routes/Signup.tsx` — minimal form (full name + email), calls `signInWithOtp`
- `src/routes/VerifyOtp.tsx` — 6-digit code entry, calls `verifyOtp`, then inserts the `people` row (`auth_user_id`, `full_name`); includes a resend-code button with a 30s cooldown
- `src/routes/Dashboard.tsx` — session-gated empty shell, shows the signed-in member's name, includes logout

Note: this is intentionally the minimal single-step signup (name + email) that Phase 0's exit criteria called for — the full 3-step wizard (personal → location → gotra) is Phase 1 scope.

## Deployment

- Git repo initialized locally, pushed to GitHub
- Deployed on Vercel, with **Root Directory** set to `member-app`
- Environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in Vercel and marked as **Config** (Vercel's label for values intentionally safe to expose client-side) rather than Sensitive — correct, since these are Supabase's public publishable key/URL, not secrets; real access control is enforced by RLS on the database
