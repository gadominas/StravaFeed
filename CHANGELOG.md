# Changelog

All notable changes to Strava Daily Digest. Generated from `releases.json`; edit that file, not this one.

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
