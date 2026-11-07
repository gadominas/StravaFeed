# Testing

Strava Daily Digest is one Scriptable script, so it can't run in a normal test runner. Two kinds of tests run it outside the phone.

## Run the testkit

Strava Daily Digest follows the [testing recipe](https://github.com/gadominas/app-blueprints/blob/testing-v1.0.0/recipes/testing.md): the shared testkit runs lint and the conformance packs (safe start-up, stability patterns, in-app updates, widgets, usage analytics). Both kinds run on your computer or in a Claude session, not on GitHub: with [app-blueprints](https://github.com/gadominas/app-blueprints) cloned next to this repository:

```sh
(cd ../app-blueprints/testkit && npm ci)
node ../app-blueprints/testkit/bin/run.js    # everything: 6 of 6 must pass before a release
node ../app-blueprints/testkit/bin/lint.js   # lint only
```

`tests/app.config.js` holds the app's per-app values.

**What it covers:** start-up (an empty window first, data read after it, the widget branch), storage without iCloud, the update offer, **Later** and the installer's checks, the widget's model, the usage-count opt-in, and lint (every button's action is handled, the bridge goes through `window.__hostBridge`).

**What it doesn't, yet:** the app has no `tests/cases` on the testkit, and Strava, the AI providers and PostHog aren't faked (`offline: ['https://']`), so the digest itself, comments and AI features are covered only by the app test below and by hand on a phone.

## The app test

`tests/app.test.js` runs the real script in the Scriptable emulator against a pretend strava.com and a pretend Claude and OpenAI: logging in and out, posting comments, kudos and 👍 All, the order of people, the number of ✨ comment ideas, the posting assistant and Save to Strava, photos (picking, clean stats, the AI redesign's upload and capped retries), comics drawn by AI, Settings (limits, instructions, migration, a broken file), comment ideas built on your draft with tone, language and photos, the day's story and the template comic, Learn my style, AI settings (keys, models, provider, token usage) and days, refresh and retry (394 checks). Run it before every release; the sections, the shared fakes and how to run it are in [tests/README.md](../tests/README.md).

**Not covered yet:** liking comments on your own activities (it taps Strava's own page), the comic template's text (it is drawn on a canvas), the widget's look beyond the testkit's widgets pack, and the real strava.com: Save to Strava and kudos are checked against a pretend one.
