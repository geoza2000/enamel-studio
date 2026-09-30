# Contributing

Use Node.js 22.12+ and install dependencies with `npm ci`.

For behavior changes, add a focused failing test, implement the smallest fix,
and run `npm test`, `npm run test:browser`, and `npm run build`. Browser tests
require `npx playwright install chromium`. Keep imported documents as inert JSON,
keep processing in the browser, and do not introduce upload services or telemetry
without an explicit design discussion.

Keep examples generic and original. Never commit credentials, personal documents,
third-party proprietary artwork, or production user data. Respect bundled
third-party notices. Describe visible changes and include a screenshot where
useful. Contributions are licensed under the project's MIT license.
