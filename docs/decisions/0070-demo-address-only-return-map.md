# Address-only return-visit map failure handling

- Status: Ready for review after demo verification; production unchanged
- Date: 2026-10-31
- Related: 0068 (linked-map retention), 0069 (production activation)

## Diagnosis

The earlier missing-pin report was not proof that all address-only maps fail.
In the live demo, a temporary diagnostic recorded only success/count/coordinate
validity, never address or account data. The original fixture address returned
SDK success with zero addresses and no coordinates. A second public address,
Yongin City Hall (Jungbu-daero 1199), returned one address with finite coordinates
and displayed its marker even BEFORE this fix. The diagnostic was then removed.

The old failure UI was only a transient toast. MobileHome also fell back from
an unresolved focused visit to every other personal return-visit building,
showing an unrelated building with zero matching units. This made a no-match
response look like a broken map or an incorrect destination.

Public reference for the comparison address:
https://yongin.go.kr/home/yiIf/yiIfHall/yiIfHall03.jsp
SDK callback contract:
https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Service.html

## Changes

- Reuse validated geocodeQuery with the original address. Do not remove locality
  or guess a replacement destination. An intermediate demo trial of the generic
  getGeocodeCandidates fallback resolved a bare road name in Cheorwon instead of
  Yongin; screenshot inspection caught this and that fallback was removed before
  the final implementation. The regression test forbids a second shortened query.
- Keep no-match/SDK failure visible with a retry action. Do not invent coordinates.
- Bound SDK readiness and response waiting to 15 seconds for the whole attempt.
- Cancel waiting timers and ignore late callbacks after route change/unmount,
  timeout or retry. Do not start more queries after an attempt is invalidated.
- Clear the previous address's pin before a different address is displayed.
- A focused return visit without a resolved building shows no other visit's
  buildings. Linked and unfiltered personal maps retain their existing scope.

No DB schema, permissions, saved addresses, or visit-history changes. The address
route remains excluded from linked-map store retention: this is failure handling,
not another data-loading optimization. Shared MapCanvas rendering is unchanged.
This bug fix has no new flag; it is deployed only to the demo project. A later
production promotion would apply the corrected behavior directly.

## Tests

- Whole suite: 2,199 tests / 224 files pass.
- Hook cases: no locality-dropping fallback, no-result/retry success, delayed SDK, missing
  SDK and missing callback deadlines, stale response on address switch, immediate
  pin clearing, and unmount cancellation (including no subsequent query).
- MobileMap wiring test: persistent failure text and retry coordinates passed to
  mocked MapCanvas. This is not a real SDK marker test.
- MobileHome regression: address-only target excludes another owned linked visit
  and its legacy regular-visit unit. Existing linked-map tests remain passing.
- TypeScript/Vite build and lint pass. Live verification details follow below.

## Demo Verification

- Final demo deployment: `dpl_jjWmkRN8hfhwfMUaf7E7wostiuWo`, READY, alias
  https://chinese-territory-app-demo.vercel.app. Applied the PWA update in browser.
- Original address-only fixture: detail -> map shows persistent address-not-found
  and retry, no pin, and zero unrelated buildings. Clicking retry returns to the
  same honest no-match result. The saved address was not rewritten.
- Valid public address route (Yongin City Hall): actual SDK marker appears over
  the city hall. This used a route-only comparison, not a saved-address edit.
- Linked fixture: detail -> map retains building 79 and unit 104, with its marker.
- Final screenshot inspection confirmed error/retry below the map, above the
  bottom sheet, without obscuring the back button or header. An earlier placement
  obscured the header and was corrected before finishing.
- Evidence (local, not committed): `scratch/demo-address-pin-error-1031.png`,
  `scratch/demo-address-pin-valid-1031.png`, `scratch/demo-address-pin-linked-1031.png`.
- Tested in the in-app browser, not a physical iPhone. Slow/missing responses and
  stale callbacks were covered by automated tests, not live network throttling.
- Fixtures 24 and 26 are ended using the normal demo end-return-visit RPC; unit
  182 remains unvisited. No visit history was written. Production is unchanged.

## Limitations And Review

This fixes failure visibility, retry/timeout, stale-pin handling and unrelated
building fallback. It does not make an unresolvable address searchable. Such an
address still needs correction; no default-city pin is presented as its location.
The shared generic candidate helper remains unchanged for its other consumers;
its locality-dropping fallback is deliberately not used by this path.
Review the hook's cancellation/reset contract, MobileHome focus filter and the
new tests before any production promotion. No operational flag is introduced.
