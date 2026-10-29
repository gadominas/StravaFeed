# Changelog

All notable changes to Strava Daily Digest. Generated from `releases.json`; edit that file, not this one.

## 1.13.0 (2026-10-29): Kudos at a glance

- 📲 **A new widget look**: The kudos widget now wears the Daily Digest logo on its dark tile, like the other apps.
- 🔒 **Every size**: Small, medium and large on the Home Screen, plus inline, round and rectangular on the Lock Screen.
- 📴 **Never an error**: Works offline from the last summary and says when it's out of date, never Scriptable's error text.

**Changes**

- Home Screen widget in the shared frame (widgets blueprint 1.0.0): logo tile and name, people waiting for kudos as the big number, who is waiting with their sport, early-riser badge and ×n, and "of 15 today, 10:22" at the bottom
- Large widget adds the day's PRs and early risers; Lock Screen widgets show "👍 15 waiting for kudos"
- The widget reads a summary saved on this iPhone, so it works offline; after the time set in Settings › Widget › "Mark the widget as out of date after" (12 h by default) its bottom line turns amber
- Before the digest has loaded today the widget says "Open to load today"; a failing widget shows the app name and "Tap to open" instead of an error
- Settings › Built with now lists the widgets blueprint

## 1.12.0 (2026-10-29): Catch up. Cheer. Move on.

- 📍 **A logo of its own**: The route digest: a route from a teal start to a rose finish, with two digest lines.
- 🎬 **Launch screen**: The route draws itself and the tagline appears for about 2 seconds; tap to skip.
- ✨ **Branded everywhere**: The logo sits in the header, on a day nobody has posted yet and in the README.

**Changes**

- New Daily Digest logo (route digest): docs/logo.svg and a 1024 px app icon, docs/icon-1024.png
- Launch screen shown for 2.4 s with a short animation and the tagline "Catch up. Cheer. Move on."; tap to skip; still with Reduce Motion (shared launch-screen blueprint 1.0.0)
- Logo mark in the sticky header with "Digest" in the brand rose, the logo on an empty day, and at the top of the README
- Settings › Built with now lists the launch-screen blueprint

## 1.11.1 (2026-10-28): Pace at a glance

- 👟 **Pace on every line**: Runs, walks and hikes show their pace next to the distance in Compact and Tiny.
- 📐 **Roomier Tiny lines**: A compact 👍 button leaves space for all the indicators; none is ever cut in half.
- ✅ **See who you've cheered**: In Tiny, the 👍 turns into ✓ once you've given kudos, so you never tap twice.

**Changes**

- Pace indicator after distance in the Compact and Tiny layouts
- Tiny layout: compact round 👍 kudos button (✓ once given)
- Tiny layout: indicators that don't fit are hidden whole instead of being cut off

## 1.11.0 (2026-10-28): Peek, then dive in

- 👆 **Tap to expand**: In Compact, each activity is one tidy line; tap it to open the full card in place.
- 🔎 **See what's inside**: Distance, trophies and photo counts on every line, so you know what's worth opening.
- 📋 **Tiny opens in place**: Tap an athlete in Tiny to expand their activities right there, no sheet.

**Changes**

- Compact layout folds each activity to its title, time and indicators; tap to expand or collapse
- Indicators for distance (or time), achievements and photos, with PRs highlighted in gold
- Tiny layout shows the same indicators and expands an athlete's activities in place
- Expanded cards stay open while details load in the background
- The details sheet always shows the full card

## 1.10.0 (2026-10-28): Make it yours

- 🎨 **Colours and layout**: Six colour palettes or Auto, plus Comfortable, Compact or a one-line Tiny layout.
- 🔠 **Text size and font**: Pick Small to Larger text and a sans or serif font for names and titles.
- 🎛 **Tune everything**: Feed depth, time limits, widget refresh and more, each with Reset.

**Changes**

- New Settings sheet (sliders icon): Appearance, Digest, AI comments, Updates, tunables and Built with; changes apply at once, no Save button
- Appearance shared with the other apps: Auto plus six palettes (Strava orange in all), Comfortable, Compact or Tiny layout, four text sizes, sans or serif headline font
- Tiny layout: one line per athlete with their main stat and kudos; tap a name for the full activity
- Tunables with ranges and Reset: feed pages, extra pages per day, details opened at once, time limits, days in the header, comment ideas per tap, widget refresh, athlete ID
- Settings move from the Keychain to settings.json in iCloud Drive › Scriptable › StravaFeed; your choices move over automatically
- Built with: the blueprints this app follows, with links to read them
- Updates identify the app by its APP_ID line, as the in-app updates blueprint describes

## 1.9.1 (2026-10-28): Claude or OpenAI, plus a settings fix

- 🤖 **Claude or OpenAI**: ✨ Comment ideas now work with either provider. Switch any time in AI settings.
- 🧠 **Pick any model**: Load the models your own key can use, choose one and test the connection.
- 📊 **See your token usage**: Tokens per day, feature and model, so you always know what AI costs you.

**Changes**

- Brings back everything from 1.9.0 (AI settings, Claude or OpenAI, model picker, token usage), which the 1.8.2 release accidentally undid

**Fixes**

- Settings errors scroll into view (from 1.8.2)

## 1.9.0 (2026-10-28): Claude or OpenAI, your choice

- 🤖 **Claude or OpenAI**: ✨ Comment ideas now work with either provider. Switch any time in AI settings.
- 🧠 **Pick any model**: Load the models your own key can use, choose one and test the connection.
- 📊 **See your token usage**: Tokens per day, feature and model, so you always know what AI costs you.

**Changes**

- New AI settings sheet (⚙︎ › AI settings): Claude and OpenAI keys, model picker loaded from your key, connection test, token usage per day, feature and model
- Keys are entered in a native secure prompt and stored in the iOS Keychain; the page only ever sees them masked
- Comment ideas go through one shared AI call, following the app-blueprints AI configuration
- ✨ Suggest, moods and language buttons stay hidden until a key is saved
- Comment ideas are labelled with the provider that wrote them
- Your existing OpenAI key and model move over automatically
- The thinking-effort setting is gone: choose a model instead

## 1.8.2 (2026-10-28): Clearer settings errors

- ⚠️ **Errors you can see**: If a setting can't be saved, the settings sheet now scrolls to the message.

**Fixes**

- A settings error could appear below the visible area, so a failed save looked like nothing happened

## 1.8.1 (2026-10-27): Tidier header

- 🎯 **Matching header icons**: Settings and refresh are now the same size and easier to tap.

**Changes**

- Settings and refresh icons drawn as matching line icons with larger tap areas

**Fixes**

- Settings icon looked smaller than the refresh icon

## 1.8.0 (2026-10-27): Settings, right in the app

- ⚙️ **Settings screen**: Tap the gear in the header to change how the digest works, no code editing.
- 🔑 **Manage your API key**: Replace or remove your OpenAI key any time; only its last 4 characters are shown.
- 🔄 **Check for updates now**: See your version and look for a new one with a single tap.

**Changes**

- Settings sheet behind a gear icon in the header
- AI settings: API key, default mood, custom prompt, language, model and thinking effort
- Digest settings: own activities, extra details, names on the widget
- Update settings: turn offers on or off, check now
- Advanced: Strava athlete ID
- Settings are kept in the iOS Keychain, so updates never reset them

## 1.7.0 (2026-10-27): Comments in your mood

- 🎭 **Comment moods**: Pick Funny, Energetic, Serious or Funky and get three comments in that tone.
- ✎ **Your own prompt**: Type how you want it, like "tease about the rain", and the AI follows.
- 💾 **Remembers your style**: Your mood and custom prompt stay selected for next time.

**Changes**

- Mood chips in the comment box: Funny, Energetic, Serious, Funky and Custom
- Custom prompt field that drives the AI suggestions
- Mood and custom prompt are remembered between runs

## 1.6.0 (2026-10-27): Never miss an update

- 🔔 **Update reminders**: The digest tells you when a new version is out. Tap Later and it waits two days before asking again.
- ⬆️ **One-tap update**: Update right from the digest. No need to run the installer again.
- ✨ **See what's new first**: Every update shows its three best features before you install it.

**Changes**

- Update check on start, with a pitch sheet showing the top three highlights
- Later snoozes update reminders for two days
- Version number shown at the bottom of the digest
- Release notes now live in releases.json, with a generated CHANGELOG.md

## 1.5.0 (2026-10-27): Kudos to everyone, with style

- 📌 **Pinned header**: Today, Yesterday and the 👍 All button stay at the top wherever you scroll.
- 🎉 **Kudos celebration**: Thumbs fly from the centre to every athlete's photo, with a ✓ as each one lands.
- 🧹 **Cleaner screen**: No more stuck pop-up at the bottom, and kudos counts look right again.

**Changes**

- Sticky header in the Go2FGym style with a compact day switcher and an always-visible 👍 All button
- Celebration animation when giving kudos to everyone
- Day switcher limited to Today and Yesterday

**Fixes**

- Pop-up message no longer peeks out at the bottom of the screen
- Kudos counts were drawn as large orange circles

## 1.4.0 (2026-10-20): A proper photo viewer

- 🔍 **Zoom photos**: Double-tap or pinch to zoom, and drag around while zoomed in.
- 🎞 **Thumbnail strip**: See the previous and next photos, and tap one to jump straight to it.
- ✕ **Big close button**: An always-visible Close photo button, so you never leave the app by accident.

**Changes**

- Pinch and double-tap zoom in the photo viewer
- Thumbnail strip with the current photo highlighted
- Large Close photo button at the bottom
- Date bar stays pinned while scrolling

**Fixes**

- Swiping between photos stopped working after zoom was added

## 1.3.0 (2026-10-19): Stable comments

- 💬 **No more crashes**: Posting a comment no longer loads Strava's heavy page every time.
- ⚡ **Faster comments**: After the first comment, the rest are sent with one small request.
- ✅ **Honest confirmation**: Only Strava's real reply to your comment counts as posted.

**Changes**

- Learns Strava's comment request once and reuses it

**Fixes**

- Scriptable could be closed by iOS while posting a comment
- A tracking request could be mistaken for a posted comment

## 1.2.0 (2026-10-18): Widget and details

- 📲 **Kudos widget**: See how many people are waiting for your kudos on the Home or Lock Screen.
- 🗺 **Activity details**: Route map, all stats and bigger photos, without leaving the digest.
- ⬇️ **Pull to refresh**: Drag the digest down at the top to reload today's feed.

**Changes**

- Home Screen and Lock Screen widgets
- Activity details sheet with route map
- Pull to refresh
- Loading screen with a running figure and a live post counter

**Fixes**

- Widget font error on Scriptable

## 1.1.0 (2026-10-16): Who's waiting for kudos

- 📥 **Waiting first**: People still waiting for your kudos are grouped at the top.
- ✈️ **Comment animation**: Watch your comment fly to your friend, with confetti when it lands.
- 🏃 **Fun loading screen**: A runner collects posts while a counter ticks up.

**Changes**

- Waiting for your kudos and Kudos given sections
- Screen locks with an animation while a comment is sent
- Animated loading screen with post counter

## 1.0.0 (2026-10-16): First public release

- 👍 **Kudos to everyone**: Two taps give one kudos to each person in the day's feed.
- ✨ **AI comment ideas**: Funny, friendly comments built from each activity's real stats.
- 👥 **Grouped by athlete**: One card per person with the numbers that matter up front.

**Changes**

- Daily digest of the people you follow, grouped by athlete
- One kudos per person, plus kudos to everyone
- AI comment suggestions in English and Lithuanian
- Early-riser badges, photo viewer, start times and PRs
