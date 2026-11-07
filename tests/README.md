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
6. The order of people in each group: early risers first (earliest first), then people with photos, then everyone else
   (newest first), checked against what each line shows, also after the details have loaded.
7. Comment ideas: exactly the number set in Settings › ✨ Comment ideas per tap (1 to 5, 3 by default). The AI is asked for
   that many, extra ones are dropped, and when it sends fewer or repeats itself the app asks once for the missing ones.
8. **Kudos and 👍 All**: one kudos reaches Strava once and moves Waiting and Kudos given; a refused one shows “Kudos not sent”
   and changes nothing; 👍 All asks first, then gives every waiting person exactly one; whoever Strava refuses stays waiting;
   your own activities have no kudos button.
9. **Posting assistant › Save to Strava** (`09-save-to-strava.js`): the ideas request carries your activity and its current
   text, New ideas carries your request, a picked title fills the box. Saving through Strava's edit form sends gear,
   visibility and commute back unchanged with the form's token; without a form, or when the form is refused, the inline
   edit is used; when Strava refuses both nothing is claimed as saved and the text is copied with **Open**. Only your
   activity is touched. Without an AI key: a note and no request.
10. **Photos** (`10-photos.js`): Photos and a cancelled camera; nothing is made when a photo is picked or the mode changes;
    📊 Clean stats sends your wishes, the stats and the photo, shows before and after, and shares the picture at its own
    size; 🎨 AI redesign sends your wishes to the art director and uploads your photo as JPEG to GPT Image (edits,
    1024×1536, high quality, high input fidelity, gpt-image-2, the numbers to letter listed); the paid retries are capped
    (an unknown parameter or model once, a refused photo never resent without it) and every error shows in the sheet.
11. **Comics drawn by AI** (`11-comic.js`): the comic factory comes and goes; a page that can't be drawn is tried once more
    without the profile pictures, then left out and counted; never more than 2 pages at once; at most 6 pages; nothing is
    shared until **📤 Share comic**; without an OpenAI key nothing is asked for.
12. **Settings** (`12-settings.js`): steppers stop at their limits, save what they show and Reset restores the default;
    Days in the header changes the header; comment, story, post and photo instructions are saved, reach their AI requests
    and reset; untouched old photo instructions move to the new default; a broken settings file opens with the defaults.

13. **Comment ideas: draft, tone, language and photos** (`13-comment-ideas.js`): your draft goes with the request and the
    ideas are marked “Built on your draft” (the first as closest); ↻ after picking an idea sends your draft, not the idea;
    a new tone asks again with that mood; Lithuanian asks again, and once more when the answer comes back in English; the
    activity's photos are looked at once and the writer gets what was seen; a model that can't read photos still gives
    ideas; without a key there is no ✨ Suggest; Cancel ignores a late answer.
14. **The day's story and the template comic** (`14-story.js`): written from the day's people; a language pick and a Rewrite
    it tweak write it again; 💥 Pop draws 1080 × 1350 pages with no picture requests and shares them on 📤 Share comic;
    without a key a note and no request.
15. **Learn my style and AI settings** (`15-style-and-ai.js`): your comments are gathered, the AI is asked once, the style is
    saved, used in comment ideas and cleared; an OpenAI key pasted in the key prompt is kept in the Keychain, the models
    are listed (GPT Image newest first), OpenAI becomes the provider and gets the next request, removing the key (two taps)
    goes back to Claude; Token usage names every feature.
16. **Days, refresh and retry** (`16-days.js`): Yesterday shows yesterday's activities and date; Refresh reads the feed again;
    a failing feed shows Try again, which brings the digest back.

Sections 0 to 7 are in `app.test.js`; 8 and up are one file each in `tests/app/` (`{ n, title, run(browser, H) }`).
They share `tests/lib/`:

| File | What it is |
| --- | --- |
| `lib/harness.js` | The emulator set-up and helpers: `opened()`, `check()`, `until()`, `tap()`, `savedSettings()`, `appConst()`, `photo()` |
| `lib/fake-ai.js` | A pretend Claude and OpenAI: each request is recognised (comment ideas, photo scan, story, comic plan, post ideas, photo design, redesign plan, style, picture), answered from the test or a default, and kept in `ai.calls` |
| `lib/fake-strava.js` | More of strava.com: kudos that can be refused, the activity edit page and its save requests (`edit.mode`: form, inline, form-refused, refuse) |
| `fixtures/lake.jpg` | The photo Photos hands over (900 × 1200, drawn) |

`opened()` also takes `routes` (checked first), `alerts` (answers for Alert prompts), `data` (the app's own files, e.g. `sent-comments`), `files` (any file by the end of its name) and `settingsRaw` (the settings file as text).

A test opens the app with what it needs: `opened(browser, { ai: fakeAI({ comments: ['One', 'Two'] }), strava, openaiKey: true,
photos: { library: [photo()] }, settings: { … } })`, then checks what the page shows and what reached the pretend services
(`ai.of('image')`, `strava.kudos`, `emu.shared`, `emu.pasteboard`, `savedSettings(emu)`).

```sh
# app-blueprints checked out next to this repository
(cd ../app-blueprints/repo-site && npm install && npm install --no-save playwright && npx playwright install chromium)
node tests/app.test.js        # everything, about 3.5 minutes; VERBOSE=1 shows the emulator's log
node tests/app.test.js 9 10   # only those sections
```
