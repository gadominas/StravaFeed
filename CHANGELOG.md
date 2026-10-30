# Changelog

All notable changes to Strava Daily Digest. Generated from `releases.json`; edit that file, not this one.

## 1.25.0 (2026-10-31): Clearer Settings

- 🗂️ **Sections you can see**: Each Settings section now sits in its own card, so you can tell where it starts and ends.
- 🔤 **Quieter headings**: Section names are small grey capitals, so they no longer look like settings.
- 🎨 **In every palette**: The cards follow your colours, text size and layout, light or dark.

**Changes**

- Settings (app-blueprints · settings 1.1.0): each section's rows sit in one card, with a thin border and a slightly lighter background, under a small muted uppercase heading
- The changed-count line and a section's explanation sit outside the cards; Built with is a card too

## 1.24.1 (2026-10-31): Counted by name

- 🏷️ **Counts say which app**: Anonymous usage counts now name Daily Digest, so they stay separate from other apps in the same place.
- 🔤 **Text size respected**: The one-time sharing question follows your text size setting.
- 🧩 **Built with**: Settings › Built with now lists Anonymous usage analytics.

**Changes**

- Every anonymous usage event carries app = stravafeed
- Settings › Built with lists Anonymous usage analytics 1.1.0

**Fixes**

- The sharing question's text ignored the text size setting

## 1.24.0 (2026-10-31): Night owl friendly

- 🌙 **Yesterday after midnight**: Open the app after midnight before anyone has posted, and it shows yesterday instead of an empty today.
- 💬 **Says so**: A small note explains why you're looking at yesterday.
- 👆 **One tap back**: Show today switches back whenever you like.

**Changes**

- Opening the app before 6 AM with nothing posted today shows yesterday, with a 🌙 note and a Show today button
- Only when the app opens: refreshing or tapping Today later shows today as before

## 1.23.2 (2026-10-31): Usage counts reach the project

- 🎯 **Right place**: Anonymous usage counts now go to the PostHog project's own region, the US cloud.
- 🧹 **Forgets the wrong address**: An address remembered by 1.23.1 is cleared, so nothing more is sent where it gets lost.
- 🧪 **Clearer test**: Send test now names the address PostHog accepted the event at.

**Changes**

- Settings › Privacy › Send test shows the address that accepted the event

**Fixes**

- Usage counts went to PostHog's EU cloud, which accepted and then dropped them because the project lives in the US cloud; 1.23.1's fallback never noticed, since the EU cloud said OK

## 1.23.1 (2026-10-30): Usage counts that arrive

- 🌍 **Finds the right cloud**: Works whether the PostHog project lives in the EU or the US cloud, and remembers which.
- 🧪 **Send test**: Settings › Privacy has a Send test button that shows PostHog's answer straight away.
- 🧾 **Logged**: Every send, and any error from PostHog, is noted in the start-up log.

**Changes**

- Settings › Privacy shows when counts were last sent and whether PostHog accepted them, with a Send test button
- Counts are sent after 3 seconds instead of 8

**Fixes**

- Usage counts were sent only to PostHog's EU cloud, so a project in the US cloud never received them
- PostHog's answer was ignored, so a refused request looked the same as a successful one

## 1.23.0 (2026-10-30): Help shape the app

- 📊 **Anonymous usage, if you agree**: A one-time question asks whether to share anonymous counts, like app opens, kudos and AI features used.
- 🔒 **Nothing personal**: Only a random install ID and counts: never names, comments, photos or your Strava account.
- ⚙️ **Your choice, any time**: Settings › Privacy turns it on or off; off also deletes the install ID.

**Changes**

- One-time question at the top of the digest: Yes, share or No thanks
- Settings › Privacy › Share anonymous usage
- When on, sends counts to PostHog's EU cloud: app opens (version, layout, theme, language, whether an AI key and a learned style exist), days viewed, kudos sent, comments posted and liked, AI ideas (mood, language, photos looked at), stories and story images made, style learning results, your own activities opened, and updates
- Events are anonymous, sent in small batches, and never slow the app; if sending fails they're dropped

## 1.22.0 (2026-10-30): Post the day's story

- 📸 **Story as a picture**: Turn the day's story into a 1080×1920 image, ready for Instagram, with the cast, title, story and photos.
- 🔳 **Scan to get the app**: Every image carries a Made with Strava Daily Digest mark and a QR code that opens the app's GitHub page.
- 📤 **Straight to the share sheet**: Save it to Photos or post it to Instagram from the iPhone share sheet.

**Changes**

- 📸 Image in the day's story makes a 1080×1920 picture: app logo and date, cast with kudos rings, title, the story (text size fitted to the space) and up to three of its photos
- Footer with the app logo, Made with Strava Daily Digest, and a QR code to github.com/gadominas/StravaFeed (built into the app, no network needed)
- Photos and profile pictures are loaded by the app so the page can draw them; the finished picture opens in the iPhone share sheet

## 1.21.0 (2026-10-30): Sunshine while you wait

- ☀️ **Your friend, shining**: While comment ideas are written, the composer turns into a sky with your friend's photo as the sun.
- 😄 **Something to read**: Funny lines rotate while you wait: scrambling the adjectives, cooking up something witty, pacing the punchline…
- 📊 **See how far along**: A progress bar follows the photos being looked at and the ideas being written; Cancel if you change your mind.

**Changes**

- Tapping ✨ Suggest covers the composer with a sky: the friend's profile picture (or initials) as the sun with turning rays, drifting clouds, rotating funny lines and a progress bar
- The bar follows the real steps: each photo looked at, then the ideas being written
- Cancel closes the sky and ignores ideas that arrive afterwards
- With Reduce Motion on, the sun and clouds stay still

## 1.20.1 (2026-10-30): Learn my style really reads your comments

- 🔎 **Opens every friend's activity**: Learn my style no longer waits for Strava to report comments; it opens friends' activities until it finds yours.
- 📅 **Reaches further back**: When today's activities run out it reads older weeks of your feed and keeps going.
- 🧾 **Shows what it did**: Settings and the start-up log show comments read, pages opened and how far back it reached.

**Changes**

- Settings › Learn my style always shows comments read, activities opened and the earliest day reached
- Each run is noted in the start-up log, with how many comments came from Strava's data and how many from pages

**Fixes**

- Learn my style opened no pages when Strava's feed didn't report comment counts, so it learned only from comments sent through the digest

## 1.20.0 (2026-10-30): Comments that see the photos

- 📷 **Comment ideas see the photos**: The AI looks at up to three of the activity's photos and builds comment ideas on what it spots.
- 📝 **Reads the description**: The whole description goes in, emojis included, so 🥐, 🌧️ or 🐶 can turn into the comment's joke.
- 🧠 **Learns from all your comments**: Learn my style now opens friends' activities one by one until it has the number you set, up to 50, with Stop.

**Changes**

- Comment ideas attach up to three of the activity's photos and ask the AI to name the objects, places, food, animals and moments it sees
- The full description goes to the AI (from the activity page when the feed shortened it), with its emojis listed
- The ✨ Suggest button says 📷 Looking at the photos… while it works, and the result says how many photos the AI looked at
- Learn my style reads Strava's comment data first, then opens friends' activity pages one at a time (friends you gave kudos to first) and reads your comments as Strava shows them, until it has the number you set
- Stop learns from what was found so far; Settings shows how many comments were read and how many activities were opened
- If the chosen model can't read photos, comment ideas are written without them

**Fixes**

- Learn my style found only the comments you'd posted through the digest when Strava's comment data had none of yours

## 1.19.0 (2026-10-30): Stories with photos

- 📸 **The AI looks at the photos**: Up to three photos per person go into the day's story, and the AI writes about what it sees in them.
- 🖼️ **Photos and faces in the story**: The cast's profile pictures sit at the top, and the photos appear right where the story talks about them.
- 📊 **Watch it come together**: A progress bar shows athletes gathered, photos loaded and the story being written.

**Changes**

- The day's story sends up to three photos per person (twelve in all, spread so more people get one) for the AI to look at, shrunk to about 768 px
- The AI places each photo under the paragraph it belongs to; tap one to open it full screen and swipe through the story's photos
- Cast row with profile pictures: an orange ring for people still waiting for your kudos, green for those who have it
- Progress bar with three steps: Athletes, Photos (with a count) and Looking at the photos and writing
- Another take reuses the photos already loaded
- If the chosen AI model can't read photos, the story is written without them and says so

**Fixes**

- Replies with line breaks inside the AI's JSON are repaired before reading

## 1.18.0 (2026-10-30): The day's story

- 📖 **The day's story**: Tap 📖 before Today and the AI writes one funny story starring everyone in the day's digest.
- 👍 **Kudos included**: Everyone's in it, whether they're still waiting for your kudos or already have it, with their real activities.
- 🔁 **Another take, or share**: Not funny enough? Ask for another take, or share the story with your friends.

**Changes**

- 📖 button at the left of the day switcher writes a story about everyone in the day's digest, in one AI request, in your comment language
- The story uses each person's activities (titles, sports, times, places, PRs, early starts, photos) and who has your kudos
- Another take writes a fresh story; Share opens the iPhone share sheet; reopening shows the same story without asking the AI again
- Route maps no longer appear on the cards; they're in the activity's details sheet
- AI settings › usage lists the day's story separately

**Fixes**

- Story replies with line breaks inside the AI's JSON are read correctly

## 1.17.0 (2026-10-30): Route maps on every card

- 🗺️ **See the route**: Runs, rides and walks show their route map right on the card, between the stats and the photos.
- ✏️ **Drawn when Strava sends no picture**: When Strava only sends the route line, the digest draws it, with start and finish marked.
- 👆 **Tap for details**: Tap the map to open the activity's details, where the same map appears.

**Changes**

- Route map on each activity card (Comfortable, and Compact or Tiny once expanded); indoor activities show none
- The route is drawn from Strava's encoded route line when there is no map picture, or when the picture fails to load
- The details sheet shows the card's map instead of a separate picture

**Fixes**

- The details sheet sometimes showed one of the activity's photos as its "route map"; the page preview picture is now used only when it really is a map

## 1.16.0 (2026-10-30): Opens every time, and shows what AI adds

- 🚀 **Opens every time**: No more blank screen when opening from the widget, after quick taps or with slow iCloud.
- ✦ **See what AI adds**: Without a key, a short card now and then shows what AI adds to your comments.
- 🩺 **Start-up log**: Settings › Updates › Start-up log shows what happened the last times it opened.

**Changes**

- The digest opens on an empty dark window first, then the launch screen, then reads its data, so a page is always drawn
- Quick taps on the widget open one window, not several
- Your Strava feed starts loading just after the first screen is up; the update check follows a few seconds later
- Without an AI key, an invitation card appears at most every 3 days (weekly after four "Later"s), never over another sheet or an update offer; "Don't remind me again" stops it for good
- Turn on AI opens AI settings with Add key highlighted; removing your last key brings the invitation back from the next launch
- Settings › Updates has a Start-up log row with the last 40 lines
- If a saved file turns out to be damaged, the digest keeps a copy of it, starts that file fresh and tells you so

**Fixes**

- Opening the digest could stay on a blank screen, most often from the widget or with slow iCloud
- A comment history or settings file that iCloud hadn't delivered could be saved over with an empty one
- If opening stalls, the screen now says so and shows the start-up log instead of staying blank
- A damaged comment history or settings file no longer stops the digest from saving your changes
- Turn on AI now highlights Add key for the provider in use, not always Claude's

## 1.15.2 (2026-10-29): Learns from more of your comments

- 🔎 **Finds your comments**: Learn my style now recognises far more of your own comments among everything it reads.
- 🪪 **Knows your name**: Looks up your name on Strava, and spots it shortened (Gediminas S.) or without Lithuanian accents.
- 📊 **Shows what it read**: Settings says how many comments it read and how many were yours. Only yours shape your style.

**Changes**

- Settings › Learn my style shows how many comments were read on how many activities, next to how many were yours
- When it finds too few, the message says how many it read and whose name it looked for

**Fixes**

- A comment's author was sometimes taken from the comment's own ID, so most of your comments weren't recognised as yours
- Your name was only known when your own activities were in the loaded feed; it's now read from your Strava profile
- Shortened names ("Gediminas S.") and names written with or without Lithuanian letters now match

## 1.15.1 (2026-10-29): A simpler comment composer

- 💬 **Less to choose from**: The composer is just your comment, the moods and the AI ideas.
- ✨ **My style leads**: ✨ My style is the first mood and the default, with your instructions behind every idea.
- ⚙️ **Tidier settings**: The Custom prompt box is gone; your instructions in Comment writing cover it.

**Changes**

- Removed the ✎ Custom mood, its prompt field in the composer and the Custom prompt setting
- Removed the Improve my draft row (Punchier, Funnier, Shorter, Warmer, In my style, Rephrase)
- A saved Custom mood now opens as ✨ My style

## 1.15.0 (2026-10-29): Comments that sound like you

- 💬 **A proper comment composer**: 💬 opens a pop-up with your draft, AI ideas and one-tap rewrites: punchier, funnier, shorter, warmer.
- 📝 **Your instructions, every time**: Write the rules once in Settings, like a witty British running mate, and every AI comment follows them.
- ✨ **Learns your style**: Reads up to 50 of your own comments and writes like you when you tap ✨ My style.

**Changes**

- Tapping 💬 opens a comment composer pop-up instead of a box inside the card; drafts are kept if you close it
- Improve my draft: Punchier, Funnier, Shorter, Warmer, In my style and Rephrase rewrite what you have written, three options each
- ✨ My style mood, first in the list: your instructions plus the style learned from your comments
- Settings › Comment writing: instructions for every AI comment (a British running-mate default, Reset to default), how many comments to learn from (5 to 50, default 20), Learn my style with progress, the learned profile and Clear
- Your instructions now take priority over the app's own defaults in every AI request; the safety rules still always apply
- Comments you post through the digest are remembered on the iPhone (last 50) as the surest examples of your style
- AI settings › usage lists style learning separately

## 1.14.0 (2026-10-29): Your activities, on top

- 🏃 **Your activities first**: Your latest one to three activities sit above everyone else's, with the kudos and comments you received.
- 👍 **See who cheered**: Tap one to see who gave kudos and read every comment, without opening the Strava app.
- ♡ **Like comments**: Tap the heart on a comment to like it right in the digest.

**Changes**

- "Your activities" strip at the top of the digest: your activities from today and yesterday, newest first, up to three side by side, each with kudos and comments received
- The strip is hidden when you have no activities of your own, and works whether or not "Show my own activities" is on
- Tapping one opens a sheet with who gave kudos (with a full list) and all comments
- Like or unlike a comment with its heart; the first like goes through Strava's own button and teaches the app the request, later likes are sent directly
- If Strava offers no way to like comments, the hearts turn read-only and say so
- Today's view reads back to yesterday in the background so yesterday's activities appear in the strip

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
