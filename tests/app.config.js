// Strava Daily Digest's per-app values for the app-blueprints testkit (recipes/testing.md › Per-app values). Starting point: packs only.
module.exports = {
  name: 'Strava Daily Digest',
  script: '../Strava Daily Digest.js',
  folder: 'StravaFeed',
  settings: { usageAsked: true, shareUsage: false, aiInvite: { off: true } },
  offline: ['https://'],   // the app's own hosts aren't faked yet: they fail like a phone without a connection
  legacyCases: true,
  lint: { ignoreActs: ['idea-cancel'] },   // wired with addEventListener where the button is made
};
