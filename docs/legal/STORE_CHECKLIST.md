# Store release checklist

Status key: DONE in repo | TODO needs you | TODO code | CHECK verify wording on the official page before relying on it

## Both stores
- DONE: report and block on posts (runs); account deletion in app; foreground-only location with a usage string; no background location; no purchases; user age gate (13+).
- TODO you: privacy policy URL and web account-deletion URL (see `site/`), support email, final app name ("Kingz" trademark/domain check is with you).
- TODO you: counsel review of `docs/legal/*` (minors, location, UGC).
- TODO code: human moderation tooling beyond the CLI; contact/feedback screen; in-app link to terms and privacy.

## Google Play
- TODO you: developer account (organization account needs a D-U-N-S number; personal accounts have a closed-testing requirement: CHECK current numbers/days on the Play Console help page).
- TODO you: Data safety form (use the table in `PRIVACY.md`), content rating questionnaire, target audience 13+ (not a "Designed for Families" app).
- TODO code: target the API level Play requires at submission time (CHECK); EAS production build; Play App Signing.

## Apple
- TODO you: Apple Developer Program (organization needs a D-U-N-S number).
- TODO you: App Privacy "nutrition label" (same table), age rating (UGC and location), review notes with a demo account and how to reach a court-check-in without being at a court.
- TODO code: Sign in with Apple is only required if third-party social login is added (currently email code only: CHECK before adding Google/Facebook login).
- Apple 1.2 UGC: filter, report, block, timely response, contact info: report/block exist; moderator response time is a process commitment.
