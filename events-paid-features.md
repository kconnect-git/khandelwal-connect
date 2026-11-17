# Events — Free vs Paid

Status: **Decided** (2026-11-16). Not yet implemented.

Part of the paywall plan: every service gets a free tier and a paid tier.
Events bring people into the community, so **attending is always free**; paid
members get the organiser tools.

Routes: `/events`, `/events/:id`, `/events/mine`, `/events/new`.

## Feature matrix

| Feature | Free | Paid |
|---|---|---|
| Browse events (Upcoming / Registered / Past) and view details | ✅ | ✅ |
| Join / leave (respecting capacity and visibility) | ✅ | ✅ |
| Receive invites to invite-only events | ✅ | ✅ |
| Create an event (still admin-approved) | ❌ | ✅ |
| Edit / cancel own event, manage invitees, send email invites | ❌ | ✅ |

## Decisions

1. **Creating events is paid.** No free monthly allowance.
2. **No attendee list ("who's going") for now.** Not building it; revisit later as a
   possible paid feature.
3. **Committee (samaj) events are always free for everyone** to view and join. An
   invite-only committee event is still limited by the invite, never by payment.

## Notes for implementation

- Enforce in `create_event` (and the invitee/email RPCs), not just by hiding the
  "Create event" button.
- Admins create committee events regardless of paid status.
- Decide what happens to a member's existing events if their plan lapses: suggested —
  they stay live and editable until they end; only *new* events need a paid plan.
