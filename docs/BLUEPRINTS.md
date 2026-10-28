# Blueprints

Strava Daily Digest follows the shared blueprints in https://github.com/gadominas/app-blueprints.
The script's `BLUEPRINTS` block is the source of truth; this table mirrors it and adds deviations.

| Blueprint | Version | Since app version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/in-app-updates-v1.0.0/blueprints/in-app-updates.md) | 1.0.0 | 1.10.0 | none |
| [settings](https://github.com/gadominas/app-blueprints/blob/settings-v1.0.0/blueprints/settings.md) | 1.0.0 | 1.10.0 | Sheet CSS is scoped under `#cfgsheet` because the digest already uses `.seg`, `.sec` and `.sw`; the app keeps its old colour names as aliases of the shared tokens; page code is ES5 to fit the page's template string; the detected athlete ID is still cached in the Keychain; the widget keeps its Strava-orange brand colours; the early-riser badge gradients are artwork, not theme colours; the athlete ID tunable has a digits-only pattern |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/ai-configuration-v1.0.0/blueprints/ai-configuration.md) | 1.0.0 | 1.9.1 | AI settings and usage live in `strava-digest-ai-settings.json` and `strava-digest-usage.json`; no background AI jobs, so “What AI does” has no switch; page code is ES5 |
