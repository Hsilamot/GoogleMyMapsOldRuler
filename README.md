# Google Maps Old Ruler

Extension Manifest V3 for Chrome/Brave that adds an old-style cumulative ruler overlay to Google Maps.

Credit: Hsilamot <git@hsilamot.com>

## Install in Brave or Chrome

1. Open `brave://extensions` or `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this project folder.
5. Open `https://www.google.com/maps/`.

## Release package

GitHub Actions builds the Chrome Web Store ZIP automatically when a tag like `v0.1.1` is pushed.
The tag version must match `manifest.json`.

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow validates the manifest/locales/content script, builds `google-maps-old-ruler-<version>.zip`, uploads it as an artifact, and attaches it to the GitHub Release.

For a manual package without tagging, open the `Release Chrome extension` workflow in GitHub Actions and run it with `workflow_dispatch`.

## Current behavior

- Adds a "Regla vieja" button near the Google Maps toolbar.
- Click "Regla vieja" and click the map to add measurement points.
- Distances are shown as cumulative total plus per-segment values.
- Cumulative distance pills are drawn next to each point on the map.
- Units can be switched between metric and imperial from the ruler panel.
- Extension metadata and UI strings are localized through Chrome i18n (`en` and `es` included).
- Map drag, scroll zoom, and normal navigation continue working because the drawing layer does not capture pointer events.
- Dragging the map does not add a point; only regular clicks do.

## Notes

This version uses Google Maps URL coordinates when they are available, including regular Maps `@lat,lng,zoomz` URLs and My Maps `ll=lat,lng&z=zoom` URLs. It also uses the visible `.gm-style` map viewport instead of the full browser window, which matters when the My Maps sidebar is open. If Maps does not expose center and zoom, it falls back to an approximate screen measurement based on the visible Google Maps scale bar.

Next likely steps:

- Add persistence per tab or route.
- Add an option to snap or label segments directly on the map.
- Improve coordinate extraction by integrating with page-level Google Maps state when available.
- Add support for more Google Maps domains if needed.
