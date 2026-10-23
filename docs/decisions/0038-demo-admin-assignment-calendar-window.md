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

### 2026-10-23 verification

- Implementation `235ac00`. Independent read-only review approved demo scope;
  reviewer ran 316 tests / 9 files. Full suite: 1,683 tests / 196 files, lint,
  build, and diff whitespace checks passed.
- Demo deployment `dpl_6eJe9UqrZt7QcSHNVDeHBRv4JzkW`, canonical demo alias.
  PWA update applied; browser script `/assets/index-aZ-xriQn.js` confirmed.
- Chrome demo administrator, direct `/assignment` entry: assigned the previously
  unassigned `테스트구 한동 1` card to `데모 관리자`. The assigned list changed from
  0 to 1 immediately, and unassigned cards from 3 to 2. Reload retained both.
- Released that test assignment using the normal UI. Assigned list returned to
  0 and unassigned cards to 3; reload confirmed restoration. The other two
  leaders remained at 6 cards each. No production writes were performed.
- From allocation, opened participation statistics and added September beside
  October. October Monday 10:00 = 1 and Tuesday 13:00 = 0; September Monday
  10:00 = 4 and Sunday 10:00 = 6, unchanged from pre-change verification.
- No browser console errors observed. Screenshots saved locally under scratch:
  `demo-assignment-saved-235ac00.png`, `demo-assignment-restored-235ac00.png`.
- Browser verification was desktop Chrome, not a physical mobile device.
  Query behavior assertions are automated integration tests, not a claim of
  measured browser transfer-byte savings.
- Production main remains `8a4ffdcd29616fafd7363f002eefefe7e2d9b5a1`.
