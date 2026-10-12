# Khandelwal Connect — New Machine Setup & Claude Handoff

Use this file to get the project running on a new computer and to give a new Claude Code session the context the old machine's Claude had. Written 12 Oct 2026, at commit `dc6b7da` ("Added Admin Tab" = Phase 5a).

---

## 1. What moves with git, and what you must copy by hand

| Item | In git? | What to do |
|---|---|---|
| All source code, migrations, Edge Functions, phase summaries, design PDFs | ✅ | `git clone` |
| `member-app/.env` (Supabase URL + publishable key) | ❌ (gitignored) | Copy the file over, or recreate it (§3) |
| Claude memory (project rules Claude learned) | ❌ (lives in `~/.claude`) | Restore it (§6). The content is also pasted below, so nothing is lost if you skip the copy |
| `.claude/settings.local.json` (project permission allowlist) | ❌ | Optional. Recreate it (§6) |
| Supabase CLI link (`member-app/supabase/.temp/`) | ❌ (gitignored) | Re-link (§4) |
| Supabase / Resend / Vercel / GitHub logins | ❌ | Log in again on the new machine |

---

## 2. Install prerequisites

- **Git**
- **Node.js 24.x** (old machine: Node `v24.13.1`, npm `11.8.0`)
- **Supabase CLI**: wasn't installed globally on the old machine, so use `npx supabase ...` (or install via Scoop: `scoop install supabase`)
- **Claude Code** (VS Code extension or CLI)
- Optional: **Python 3**. Some past Claude sessions used small throwaway Python scripts (e.g. the migration generator in `phase-5a-summary.md` §4). Python is **not** installed on the old machine, and the app doesn't need it.

---

## 3. Clone and run the member app

```bash
git clone https://github.com/kconnect-git/khandelwal-connect.git "Khandelwal Connect"
cd "Khandelwal Connect/member-app"
npm install
```

Create `member-app/.env` (copy the one from the old machine, or fill these in from Supabase Dashboard → Project Settings → API):

```
VITE_SUPABASE_URL=https://agxygngazgmemplcogho.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key: sb_publishable_...>
```

Use the **publishable** key only. Never put the secret/service-role key in the frontend `.env`.

```bash
npm run dev       # local dev server (Vite)
npm run build     # tsc -b && vite build. Run this to type-check before committing
npm run lint      # oxlint
```

Local dev talks to the **live** Supabase project. There's no local Supabase/Docker stack.

---

## 4. Backend (Supabase): how it's actually operated

- **Project:** `agxygngazgmemplcogho` (region Singapore), URL above.
- **Auth:** Email OTP (6-digit code), SMTP via **Resend** from verified domain `lakshya-khandelwal.com`.
- **Migrations** live in `member-app/supabase/migrations/0001…0019`. They were all **applied by hand in the Supabase SQL Editor**, not with `supabase db push`. Each migration ends with a verification block. Run it after applying.
- **Schema mirror:** `member-app/supabase/ddl/core_schema.sql`, `enable_rls.sql`, `bucket_policies.sql` are the canonical "current state" DDL. Keep them in sync with every new migration (see `phase-5a-summary.md` §4 for the edit-mirror-first → generate-migration approach).
- **Edge Functions** (deployed manually; there's no CI for them):
  ```bash
  cd member-app
  npx supabase login
  npx supabase link --project-ref agxygngazgmemplcogho
  npx supabase functions deploy send-family-invite
  npx supabase functions deploy send-event-invite
  npx supabase functions deploy send-member-status
  ```
  Secrets are already set on the project (they live in Supabase, not on your machine). You only need to re-set them if they change:
  ```bash
  npx supabase secrets set RESEND_API_KEY=... RESEND_FROM_ADDRESS="Khandelwal Connect <...@lakshya-khandelwal.com>" SITE_URL=https://<your-vercel-domain>
  ```
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically.)
- **Deploy order** when a change touches both: SQL migration → Edge Function → frontend.
- **Admins** are rows in the `admins` table (`role` = `super_admin` | `moderator`). There's no UI for adding admins yet. Use a SQL insert.

## 5. Frontend hosting (Vercel)

- Vercel project with **Root Directory = `member-app`**, auto-deploys on push to `master`.
- Env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are set in Vercel (marked Config). Redeploy after changing them.
- `member-app/vercel.json` has the SPA catch-all rewrite, so deep links work.
- Nothing to set up on the new machine except `git push` access.

---

## 6. Restoring Claude's context

### 6a. Fastest: copy the Claude project folder

On the old machine the project's Claude data lives at:

```
C:\Users\laksh\.claude\projects\e--Lakshya-Columbia-MSDS-Projects-Khandelwal-Connect\
    memory\            ← the learned rules (small, important)
    *.jsonl            ← past session transcripts (large, optional)
```

The folder name comes from the project's path (`e:\Lakshya\Columbia MSDS\Projects\Khandelwal Connect` → `e--Lakshya-Columbia-MSDS-Projects-Khandelwal-Connect`). On the new machine:
1. Open the project once in Claude Code so it creates its own folder under `~/.claude/projects/`.
2. Copy the old `memory\` folder into that new folder. If the path is different, the folder name will be too. Copy into the new one; don't reuse the old name.
3. Copying the `.jsonl` transcripts is optional. They only matter if you want `/resume` to show old sessions.

### 6b. If you don't copy anything: the memory, verbatim

There is one memory. To recreate it, tell Claude on the new machine: *"Remember this as a feedback memory"* and paste:

> **Keep the onboarding wizard short.** Never add fields to the 3-step onboarding wizard (`StepPersonal` / `StepLocation` / `StepGotraBackground`). New profile data goes into the tabbed Profile page (`/profile`, Phase 3c) as a section on the relevant tab (`lib/profileTabs.ts` → `PERSON_TAB_FIELDS`), and is tracked in `profileCompletion.ts` with `requiredForWizard: false`.
> **One approved exception (Phase 3c, 12 Sept 2026):** the wizard's single "Full name" box became First name + Last name (both required). Middle name is Profile-only. This doesn't loosen the rule.
> **Why:** onboarding must stay fast for an older, less tech-comfortable community, and a new required wizard field would mark every existing member incomplete.
> **Also:** keep free-text fields to a minimum. A free-text "profession" was rejected in favour of a fixed occupation select, which spouse/child profession also reuse.

### 6c. Settings (optional)

Project-level `.claude/settings.local.json` on the old machine:
```json
{ "permissions": { "allow": ["WebSearch", "Bash(npm run *)"] } }
```
Global `~/.claude/settings.json` used `"model": "opus"` with high effort. The global `~/.claude/CLAUDE.md` only configures the `graphify` skill, which this project doesn't need.

### 6d. First prompt for Claude on the new machine

> Read `MACHINE-SETUP.md`, then `khandelwal-connect-project-context.md` §0, then `phase-5a-summary.md` (especially §4–§6). Skim the earlier `phase-*-summary.md` files only as needed. Then tell me what's done and propose a plan for Phase 5b.

---

## 7. Where the project stands

**Done:** Phases 0, 1, 2, 3a, 3b, 3c, 4, 5a, all committed and pushed, working tree clean.
- 0: Supabase + email OTP + Vite/React shell (dark vermilion, Archivo + Hanken Grotesk, light/dark toggle)
- 1: 3-step onboarding wizard, dashboard, member codes `KHA-<state>-<4 digits>`
- 2: Family details (plain-text names + optional member-code link, invite-by-email)
- 3a: Directory, member profiles, profile photos, nav
- 3b: Occupation + business listings
- 3c: Tabbed `/profile` page (7 tabs, per-tab save, name split)
- 4: Member-created events + admin approval, RSVP, invite emails
- 5a: Member approval gate (`people.member_status`, `/pending`, `/admin/approvals` with Members · Events tabs, status emails, "Hide my number")

**Next: Phase 5b, the admin console:** `/admin/*` shell + `AdminContext` (fetch `is_admin()`/`admin_role()` once), overview dashboard, members table with filters + CSV export, admin member detail view (`admin_get_member`), businesses moderation (`is_hidden`), events queue rebuilt on the shell, audit-log viewer (`admin_list_audit_log`), admin management UI, "resend status email". Must also fix the two "non-member admin is locked out" bugs in `phase-5a-summary.md` §5.

**After that:** 5c (in-app notices with audience targeting), 6 (matrimony; copy the events access model), 7 (hardening/launch).

**Unverified from the last machine:** `phase-5a-summary.md` §6 lists a smoke test for 0019 / `send-member-status`. Re-run it if you're not sure it was completed.

---

## 8. Conventions to keep (the short version)

- **`people` RLS stays self-only.** Cross-member reads go through `SECURITY DEFINER` RPCs with fixed column tiers.
- **Membership gate = `member_status = 'approved'`** (via `is_approved_member()`), not `member_code is not null`.
- **Access models:** businesses = RLS for owner writes + RPCs for reads; events = **RPC-only writes**. New lifecycle-heavy features (matrimony) should copy events.
- **Admin roles** extend the `admins` table. Never add a role column to `people`.
- **Edge Functions:** call via `invokeEdgeFunction` (`src/lib/edgeFunctions.ts`); verify the caller's JWT, then use the service role plus an explicit permission check inside the function. Email failures are non-fatal.
- **Wizard stays short** (see §6b).
- Accent `#FF4D2E` only for CTAs/active states, never body text. Min 15px body. WCAG AA contrast.
- Every phase ends with a `phase-<n>-summary.md` handoff and an update to §0 of `khandelwal-connect-project-context.md`. Keep doing this; it's how context survives between sessions and machines.
