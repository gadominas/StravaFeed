# Releasing a new version

`releases.json` is the single source of truth for versions and release notes. The app reads it from GitHub to decide whether to offer an update, and uses it to pitch the update to users.

## Steps

1. **Bump the version** in `Strava Daily Digest.js`: `const VERSION = '1.7.0';`. Use [semantic versioning](https://semver.org): a new feature bumps the middle number, a fix-only release the last.
2. **Add a release at the top of `releases.json`**, with the same version.
3. **Regenerate the changelog**: `node tools/changelog.js`.
4. **Commit everything to `main`**: the script first, then `releases.json` and `CHANGELOG.md`. In that order the update offer can never appear before the new script is there to download.

Users see the update the next time they open the digest. GitHub can take a few minutes to serve new files.

## Release entry format

```json
{
  "version": "1.7.0",
  "date": "2026-11-02",
  "title": "Short headline for the update sheet",
  "highlights": [
    { "icon": "🔔", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "⬆️", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "✨", "title": "Feature name", "text": "One sentence on what it does for the user." }
  ],
  "changes": ["Everything new, one line each"],
  "fixes": ["Every bug fixed, one line each"]
}
```

## Writing good highlights

The three highlights are the update pitch. They are the first thing a user reads before deciding to update.

- **Exactly three**, ordered by how much a user will care.
- **Title:** two to four words, naming the benefit rather than the implementation.
- **Text:** one sentence, under 100 characters, saying what the user can now do.
- **Icon:** one emoji.

If a user skipped several versions, the pitch shows the newest release's highlights first and fills any gaps from older releases they missed.

## Behaviour in the app

- The digest checks `releases.json` once per run, in the background, without slowing the start.
- **Update now** downloads the script over the current one; the user reopens the digest to start the new version.
- **Later**, or tapping outside the sheet, hides the pitch for two days.
- Users can turn checks off with `CHECK_UPDATES: false`.
