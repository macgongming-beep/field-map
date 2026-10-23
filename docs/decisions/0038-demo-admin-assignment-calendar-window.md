# 0038 - Demo admin allocation shares the home calendar window

## Decision

Demo-only extension of 0037. For actual admin/developer accounts, `/assignment`
uses the same recent-14-days-plus-future calendar scope as home. Opening admin
card allocation from home therefore does not trigger a full historical calendar
read. Direct entry and foreground refresh retain the recent window, not zero
calendar reads. Shared calendar consumers are not replaced with an empty list.

DesktopAdminAssignment uses cards and leaders; MobileAdminAssignment also uses
buildings. Neither consumes historical calendar events. Calendar event team
allocation is a separate flow and remains unchanged. `setCardLeaders` already
refreshes only cards, so mutation behavior is not changed.

## Boundaries

- Production keeps full calendar reads; no production flag is enabled.
- User/leader accounts, unknown roles, and unsupported routes remain full.
- Event/chat deep links remain full even on the allocation route.
- Statistics and its multi-month participation reports remain full, deliberately.
- Old calendar editor/month demand must not widen the admin allocation window.
- This is not a new permission boundary or a change to card/leader write rights.

## Verification

Role/route tests cover admin/developer, production, non-admin roles, deep links,
statistics, and stale editor demand. Hook integration covers home -> allocation
without another calendar read, assignment save refreshing cards, scoped
foreground refresh, and subsequent statistics restoring old participants.

Independent review and live demo save/list/reload/restoration results will be
recorded after deployment. No monthly savings estimate is claimed: admin
allocation frequency and actual transfer bytes have not been measured here.
