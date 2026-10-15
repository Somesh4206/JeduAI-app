# JeduAI for iOS

A thin, native iOS shell (UIKit + WKWebView) around the JeduAI web app — the
iPhone/iPad counterpart of the Android APK. The server is **baked in**:

```
https://jeduai-app.space-z.ai
```

The app connects straight away on first launch — the user is never asked for a
server address, and there is no way to change it from inside the app.

## Feature parity with the Android client

| Feature | Behaviour |
|---|---|
| Locked server | Connects to the baked-in URL on every launch |
| Offline screen | Branded "Can't reach the server" view with a single **Try Again** button |
| Progress bar | Thin indigo progress bar under the status bar |
| Pull to refresh | Native UIRefreshControl |
| Swipe back | Edge-swipe back/forward navigation gestures |
| External links | Opened in Safari (same behaviour as Android) |
| File uploads | Native document/photo picker (document reader, media studio, notebook sources) |
| Blob exports | CSV/Markdown exports saved via the iOS **share sheet** (Save to Files, AirDrop…) |
| File downloads | e.g. the `.apk` link — fetched and offered through the share sheet |
| App icon | 1024×1024 single-size AppIcon (brand gradient + J) |

## Build & install

> Apple does not allow compiling/signing iOS apps outside macOS, so this
> sandbox ships the **source project**; the builds below happen on a Mac.

### Option A — Run on your iPhone today, free (7-day personal signing)

1. Open `ios/JeduAI.xcodeproj` in **Xcode** on any Mac (14+).
2. Select the **JeduAI** target → **Signing & Capabilities**.
3. Tick *Automatically manage signing* and pick your **personal team**
   (sign in with a free Apple ID under Xcode → Settings → Accounts).
4. If signing complains, change the bundle ID
   (`app.jeduai.ios`) to something unique to you, e.g. `com.yourname.jeduai`.
5. Plug in your iPhone (trust the computer), select it as the run destination,
   then **Product ▸ Run** (⌘R). On the phone, approve *Settings → General →
   VPN & Device Management → your Apple ID*.

A free Apple ID signs the app for **7 days** (re-run from Xcode to renew) with
a limit of 3 personal apps per device — perfect for trying it out.

### Option B — TestFlight / App Store (Apple Developer Program, $99/yr)

1. Do steps 1–3 above with your paid team's signing certificate.
2. **Product ▸ Archive** → *Distribute App* → *App Store Connect*.
3. Add the build to **TestFlight** to share with up to 10,000 testers, or
   submit for App Store review.

### Option C — Verify the build without a Mac (CI)

The repo includes `.github/workflows/ios-build.yml` (manual trigger):
GitHub's macOS runner compiles the project for the iOS Simulator and reports
success/failure. It cannot produce an installable `.ipa` (that needs signing
certificates), but it proves the project builds cleanly.

### Option D — No Mac, no Apple account: the web app

iPhone/iPad users can install JeduAI as a **full-screen web app** today:
open the site in Safari → **Share** → **Add to Home Screen**. Same account,
same data, app icon on the home screen, offline shell — zero Apple tooling.

## Customising

- **Server URL** — `ViewController.swift`, `serverURL` constant (change, then
  rebuild). Version lives in the Xcode target's `MARKETING_VERSION` /
  `CURRENT_PROJECT_VERSION` (currently 1.2 / 3, matching Android).
- **App icon** — replace `JeduAI/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png`
  (1024×1024, opaque, no alpha).

## Project layout

```
ios/
├── JeduAI/
│   ├── AppDelegate.swift        # app entry, scene wiring
│   ├── SceneDelegate.swift      # window + root view controller
│   ├── ViewController.swift     # WKWebView shell (server, offline, picker, blob bridge)
│   ├── Info.plist
│   └── Assets.xcassets/         # AppIcon (1024 single-size)
└── JeduAI.xcodeproj/            # hand-rolled, Xcode 14+ compatible
    ├── project.pbxproj
    └── xcshareddata/xcschemes/JeduAI.xcscheme
```
