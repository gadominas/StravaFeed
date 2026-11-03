# Tests

## The app test (`app.test.js`)

Logging in and posting comments must always work, so this test runs before every release and on every push (`.github/workflows/app-test.yml`).
It runs the real script in the Scriptable emulator from [app-blueprints](https://github.com/gadominas/app-blueprints) (`repo-site`)
against a pretend strava.com whose session can end and start again, and checks what a person does:

0. Every button's `data-act` is handled by the page or the app (a button nothing answers looks fine and does nothing), and no two
   top-level page functions or vars share a name (the later one would silently replace the other).
1. Opening while logged out: the login page shows, **Log in to Strava** opens Strava's login, logging in opens the digest.
2. **Settings › Account › Log out of Strava** (two taps), then logging back in, twice in a row.
3. Logging out when Strava keeps the session: the "Almost logged out" page, **Open Strava**, then the login page.
4. Posting comments in the Comfortable and Tiny layouts: the text reaches Strava, **Delivered** shows and closes by itself,
   the comment sheet closes and the digest scrolls again.
5. Your own activities: never in the feed (even with the old "Show my own activities" switch saved as on), only in
   **Your activities** on top, side by side, and not counted by **👍 All**.

```sh
# app-blueprints checked out next to this repository
(cd ../app-blueprints/repo-site && npm install && npm install --no-save playwright && npx playwright install chromium)
node tests/app.test.js        # VERBOSE=1 shows the emulator's log
```
