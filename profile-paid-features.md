# Profile — Free vs Paid

Status: **Decided** (2026-11-17). Not yet implemented.

Part of the paywall plan: every service gets a free tier and a paid tier.
Profile stays **free**: every filled-in profile is what paid members are paying to
see in Directory, Matrimony and Business, so nothing should discourage filling it in.

Route: `/profile` (tabs: Personal, Contact, Cultural, Residence, Business, Spouse,
Children).

## Feature matrix

| Feature | Free | Paid |
|---|---|---|
| View and edit all 7 tabs | ✅ | ✅ |
| Profile photo | ✅ | ✅ |
| Link family members by member code | ✅ | ✅ |
| Hide my mobile number | ✅ | ✅ |
| **Paid member badge** on profile and directory card *(new)* | ❌ | ✅ |
| "Who viewed my profile" *(new)* | — | **Later** |

## Decisions

1. **Everything that exists in Profile today stays free.**
2. **Paid members get a visible badge** on their profile and directory card. It is
   social proof, and tells others this member can reply / contact them.
3. **"Who viewed my profile" — later.** Not in the first paywall release. When built,
   it is a paid feature. (The Directory's daily-view counter could record the views
   it needs.)

## Notes for implementation

- Badge needs the member's paid status returned by `list_directory` and
  `get_member_profile` (just a boolean, no plan details).
- Decide later whether the badge also shows in Matrimony cards and business listings.
