# Repair production Sentry DSN configuration

- Date: 2026-11-14 (started 2026-11-13 KST)
- Implementation: `f925765`
- Scope: monitoring configuration only; no DB or application-data mutation

## Cause and change

The production browser reported `Invalid Sentry Dsn`: VITE_SENTRY_DSN contained
the complete Sentry setup example rather than its public DSN URL. Replaced the
value with the existing example's public URL, preserving the same Sentry project.
The Vercel variable is sensitive and shared by production and preview; both
targets remain attached. The separate demo Vercel project was not changed.
Environment pulls return an empty placeholder for this sensitive variable, so
that output must not be interpreted as its stored value being empty.

Vercel CLI env update failed because it attempted to submit the sensitive key.
The subsequent authenticated PATCH changed only the value, preserving key,
type, and target metadata. No credential or entire environment dump is committed.

The same normalizeSentryDsn helper now validates configuration at Vite config
load and runtime initialization. Optional absent DSNs remain disabled. Invalid
nonempty values fail the build; runtime warnings never echo the supplied value.
No code snippet is evaluated or automatically extracted. User scope changes
require an initialized SDK client. Existing token scrubbing, masked replay,
sampling, and sendDefaultPii=false remain unchanged.

## Verification

- Full suite: 2,359 tests / 235 files passed; lint passed.
- TypeScript/Vite production build with production public flags and corrected
  DSN passed. Existing bundle-size/deprecation warnings remain.
- Deliberately invalid DSN: Vite exits 1 with the generic validation message.
- Bypassing runtime validation: 10 of 13 new tests fail; restored source passes
  all 18 focused Sentry tests (including existing token-scrubbing tests).
- A temporary local browser page imported the actual src/lib/sentry.ts and
  initialized it with production mode and the corrected DSN. It loaded no app
  session or application data. Four synthetic capture attempts were made while
  adding transport diagnostics; these are not real user failures.
- Final diagnostic event: `c1ba6f0e997547c8ad376ee2a441c1d8`, message
  `Field Map Sentry configuration smoke 2026-11-14`, tag
  `diagnostic:sentry-config-20261114`. SDK afterSendEvent reported HTTP 200 and
  flush completed. Evidence: scratch/sentry-smoke-accepted.png (not committed).
- This verifies browser SDK transport to the existing Sentry ingest endpoint,
  not yet Sentry issue indexing. The Sentry dashboard requires user login;
  the login tab is retained for follow-up. The test page is local, not a
  diagnostic route deployed to production.

## Deployment and follow-up

Production main `f925765` deployed successfully as
`dpl_8NAtEdiU9HtYi1fDhh58LzJ61xmi`, Ready, aliased to
https://chinese-territory-app.vercel.app. The canonical HTML loads
`index-xJoPW0It.js`; its imported `useCardDirectory-BnFU7P2v.js` contains the
correct public DSN URL, validation, and sendDefaultPii=false, not the pasted
setup snippet. Users retain the normal PWA update flow; no forced reload or
browser cache clearing is used.

The existing production Chrome session applied the normal waiting update.
Its DOM script source matches index-xJoPW0It.js and the calendar rendered.
The retained Invalid Sentry Dsn console entries refer to the old vendor chunk
before update; no new DSN warning was observed after activation. Unrelated
chrome-extension:// M_ID errors were present; this is not a claim that all
browser console errors are gone.

After Sentry login, locate the diagnostic event/tag above and confirm issue
indexing. HTTP 200 alone is not asserted to prove dashboard visibility.
Keep the corrected DSN when rolling back application code. Do not restore the
broken setup snippet. Removing the DSN intentionally disables monitoring and
requires a fresh deployment; it is not the normal rollback choice.
