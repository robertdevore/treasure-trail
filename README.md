# Treasure Trail

A personal GPS treasure hunt builder.

## What It Does

Treasure Trail is a **local-only Progressive Web App** that lets anyone create, play, and manage GPS-based treasure hunts entirely in the browser. No backend, no accounts, no server-side storage. All hunt data, progress, and settings live in your device's local storage.

Create private location-based hunts, find hidden treasures, and unlock rewards — perfect for park adventures, family geocaching, or location-based reward games.

## Privacy Model

**Your hunts stay on your device. Treasure Trail does not upload your locations or progress anywhere.**

- The public repository contains only generic app code and fake sample data.
- Real hunt locations and progress are saved only in your browser's localStorage.
- Real geolocations are never sent to GitHub, a database, or any backend server.
- Other people using the same public URL do not see your hunts.
- If you export a hunt JSON file, that file may contain private coordinates — only share it with people you trust.
- If you clear browser data, switch browsers, or use another device, your local hunts may not be available unless manually exported/imported.

Map tiles may be loaded from OpenStreetMap. Your browser may contact the map provider to display the map.

## How To Run Locally

```bash
cd treasure-trail
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

**Note:** Geolocation features may require HTTPS. For local testing, `localhost` is often treated as a secure context by browsers.

## How To Deploy To GitHub Pages

1. Create a GitHub repository.
2. Add all files from this project.
3. Commit and push to the `main` branch.
4. Go to **Settings → Pages**.
5. Under "Build and deployment", select "Deploy from a branch" and choose `main`.
6. Save. GitHub will provide your public URL (e.g., `https://username.github.io/treasure-trail/`).
7. Open the HTTPS URL on your phone.
8. Grant location permission when prompted.
9. **Add to Home Screen** for the best PWA experience.

## How To Use On Phone

1. Open the HTTPS URL in your phone's browser.
2. Tap **Build/Edit Hunt** to create a new treasure hunt.
3. Add treasure locations using your current GPS, map tap, or manual coordinates.
4. Return to the home screen and tap **Start Hunt**.
5. Keep the app open while walking to your treasure locations.
6. When you get close enough, the treasure unlocks automatically!
7. Find all treasures to reveal the final reward.

## How To Add Treasure Locations

- **Current GPS**: Use the "Use My Location" button in the builder to capture your current position.
- **Tap Map**: Tap anywhere on the map to set a treasure location.
- **Manual Coordinates**: Type or paste latitude/longitude values directly.

## How To Export/Import

- **Export**: From the builder or settings, export your hunt as a JSON file.
- **Import**: From the home screen, import a previously exported hunt JSON file.
- **⚠️ Warning:** Exported hunt files may contain private coordinates. Only share them with people you trust.

## Known Limitations

- Browser location requires permission (tap "Allow" when prompted).
- HTTPS is required for geolocation on most devices.
- GPS accuracy varies by phone, sky visibility, buildings, trees, and weather.
- Background tracking is limited — keep the app open during your hunt.
- The map requires a network connection (map tiles are not cached offline).
- Browser storage is device/browser-specific.
- Clearing browser data deletes local hunts — export them first!
- Vibration and audio effects may not work in all browsers.

## Safety

- ⚠️ Stay aware of your surroundings while hunting.
- Do not enter unsafe or private areas.
- Children should be supervised by an adult.
- Do not cross roads without an adult.
- Use in safe parks, yards, and trails.

## Tech Stack

- Vanilla HTML/CSS/JavaScript
- [Leaflet.js](https://leafletjs.com/) for maps
- PWA: Service Worker + Web Manifest
- No build step, no framework, no backend
