# Business — Free vs Paid

Status: **Built in Phase 11.5** (2026-11-17, migration `0037`). Live once a super admin turns the Business paywall on in /admin/access.

Part of the paywall plan: every service gets a free tier and a paid tier.
The general rule across the app: free members can see **who and what exists**;
paid members get **how to reach them** and the tools that bring them business.

KC Business hub: `/business`. Four live parts below. "Soon" tiles (Products & Services,
Meetings & Events) are paid when they are built.

## a) Business Directory — `/businesses`, `/businesses/:id`

| Feature | Free | Paid |
|---|---|---|
| Browse, search, filter listings | ✅ | ✅ |
| Name, logo, category, city, state, short description, Verified tag | ✅ | ✅ |
| Products list | ✅ | ✅ |
| Save / bookmark a listing | ✅ | ✅ |
| Phone, business email, website, social links | ❌ | ✅ |
| Send an enquiry (goes to the owner's dashboard) | ❌ | ✅ |
| **List your own business** (create / edit, admin review as today) | ✅ | ✅ |

## b) Buy & Sell — `/business/market`

"Respond" is what reveals the poster's phone (`respond_to_business_post`).

| Feature | Free | Paid |
|---|---|---|
| Read posts | ✅ | ✅ |
| Respond to a post (reveals phone) | ❌ | ✅ |
| Create a requirement or offer | ❌ | ✅ |

## c) Referrals — `/business/referrals`

| Feature | Free | Paid |
|---|---|---|
| Receive a referral | ✅ | ✅ |
| Give a referral | ✅ | ✅ |

## d) My Business Dashboard — `/business/dashboard`

| Feature | Free | Paid |
|---|---|---|
| See counts (e.g. "3 people enquired", views) | ✅ teaser | ✅ |
| Read enquiries and who sent them, leads, mark done | ❌ | ✅ |

## Decisions

1. **Listing a business is free.** It keeps the directory full, and every listing is
   something paid members can contact. Owners are monetised through the dashboard.
2. **Dashboard is a teaser for free owners:** they see that enquiries exist
   ("3 people enquired") but must upgrade to read them.
3. **Referrals stay free both ways** (giving and receiving) — they build the community.
4. **Buy & Sell:** reading is free; responding and posting are paid.

## Added while building (11.5)

- **Office address stays free,** like city and state. Only phone, email, website and social links are paid.
- **Lapse rule for Buy & Sell:** a member who already responded to a post can still open that poster's WhatsApp after their access lapses.
- **Admins get Business automatically,** as with every service. Several current listing owners are admins, so they'll see their enquiries regardless.

## Notes for implementation

- Enforce in the RPCs (`get_business`, `respond_to_business_post`,
  `create_business_post`, `send_business_enquiry`, dashboard RPCs), not just the UI.
- An owner's own listing always shows its full details to that owner.
- Contact fields on a listing are already partly controlled by `show_phone`; the
  owner's choice still wins over paid status.
