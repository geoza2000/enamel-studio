# Enamel Studio

A browser-based designer for 3D enamel badges, achievement medallions, and pins.
Draw wire paths, colour the enclosed cells, and preview the result in metal and
enamel. No account, cloud storage, API key, or backend required.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. A browser with WebGL2 is required for
3D previews and image exports. Use a desktop pointer for detailed curve editing;
the controls also adapt to narrow screens.

## Design and export

1. Choose a blank shape, metal, size, and wire width.
2. Draw lines or circles. Drag anchors and curve handles; use Move to reposition
   a whole wire. Close a loop or connect a wire to the border to form cells.
3. Select a cell and choose its enamel colour.
4. Adjust thickness, cut depth, dish, and roughness.
5. Download an editable **JSON document**, a transparent **1024 × 1024 PNG**, or
   the alternate unearned-state PNG. Reopen JSON with the browser file picker.

Files are processed locally in the browser, not uploaded. JSON is data, never
executable JavaScript. PNG is a flattened image, not an editable project format.
Only Enamel Studio version-1 JSON documents are supported; SVG, raster-image,
and JavaScript-module imports are not supported.

**Save before closing or refreshing:** there is no autosave or cloud backup.
Browser downloads are the durable copy of your design. New-design confirmation
protects against accidental resets, but does not replace downloading your work.

## Build and test

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm run preview
```

`dist/` contains the static site. Serve that directory using any static HTTP
host. The build uses relative asset paths, including for subdirectory hosting.
Do not open `index.html` directly using `file://`. Development tooling is local
only; no development server is needed on a static host.

A GitHub Actions definition is provided as `.github/check.yml.example`. To enable
hosted CI, move it to `.github/workflows/check.yml` and push using credentials
with workflow-write permission. It is not active by default.

## Project layout

- `src/app.mjs`: interactive editor and browser file operations
- `src/document.mjs`: versioned JSON format and input validation
- `src/kernel/`: silhouette, polygon geometry, material, and WebGL rendering
- `test/`: document and geometry tests
- `tests/`: real-browser import/download and layout checks
- `public/THIRD_PARTY_NOTICES.txt`: notices distributed with the built site

## Privacy and scope

The app includes no analytics, login, remote fonts, or external asset CDN. The
static host can still log ordinary requests for app files. Imported designs stay
in page memory unless you download them. Very complicated wire arrangements can
be slow; the import format deliberately limits document and geometry sizes.
Colour cells after finalizing the wire layout: reshaping a cell changes its
geometry identity and can require assigning its colour again.

## Branding and license

This is an independent enamel-art tool, not an official product of any device,
fitness, or platform vendor. It does not include vendor logos, proprietary
award artwork, or bundled vendor fonts. A metallic/enamel appearance is the
creative direction, not a claim of affiliation or permission to copy artwork.

Use your own designs or assets you have permission to use. The software license
does not grant trademark rights or rights to third-party artwork. Branding and
artwork should be reviewed before a public launch.

Code is available under the [MIT license](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt).
