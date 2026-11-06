# Testing

Strava Daily Digest is one Scriptable script, so it can't run in a normal test runner. Two kinds of tests run it outside the phone.

## Run the testkit

Strava Daily Digest follows the [testing recipe](https://github.com/gadominas/app-blueprints/blob/testing-v1.0.0/recipes/testing.md): the shared testkit runs lint and the conformance packs (safe start-up, stability patterns, in-app updates, widgets, usage analytics) on every push (`.github/workflows/tests.yml`). With [app-blueprints](https://github.com/gadominas/app-blueprints) cloned next to this repository:

```sh
(cd ../app-blueprints/testkit && npm ci)
node ../app-blueprints/testkit/bin/run.js    # everything: 6 of 6 must pass before a release
node ../app-blueprints/testkit/bin/lint.js   # lint only
```

`tests/app.config.js` holds the app's per-app values.

**What it covers:** start-up (an empty window first, data read after it, the widget branch), storage without iCloud, the update offer, **Later** and the installer's checks, the widget's model, the usage-count opt-in, and lint (every button's action is handled, the bridge goes through `window.__hostBridge`).

**What it doesn't, yet:** the app has no `tests/cases` on the testkit, and Strava, the AI providers and PostHog aren't faked (`offline: ['https://']`), so the digest itself, comments and AI features are covered only by the app test below and by hand on a phone.

## The app test

`tests/app.test.js` runs the real script in the Scriptable emulator against a pretend strava.com: logging in and out, posting comments and the order of people in the feed. It runs on every push (`.github/workflows/app-test.yml`); how to run it locally is in [tests/README.md](../tests/README.md).
