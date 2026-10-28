# Blueprints

Strava Daily Digest follows the shared app blueprints in [gadominas/app-blueprints](https://github.com/gadominas/app-blueprints), so it looks and behaves like the other apps. Coding agents: read that repository's [AGENTS.md](https://github.com/gadominas/app-blueprints/blob/main/AGENTS.md) before changing these parts.

| Blueprint | Blueprint date | Applied in version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/main/blueprints/in-app-updates.md) | 2026-10-27 | 1.6.0 | Predates the blueprint: identifies downloads by a function name instead of an `APP_ID` line |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/main/blueprints/ai-configuration.md) | 2026-10-28 | 1.9.0 | AI settings and usage live in `strava-digest-ai-settings.json` and `strava-digest-usage.json` (the app keeps its own settings in the Keychain); no background AI jobs, so “What AI does” has no switch; page code is ES5 to fit the page’s template string |
