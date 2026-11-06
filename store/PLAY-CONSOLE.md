# Google Play launch guide

Everything to paste or answer in Play Console. Check each answer is still true before submitting; you're responsible
for what's declared. These answers assume online play is ON. If the build ships with it OFF, see "Data safety".

## Listing

**App name (30 max):** Neon Serpent: Arcade Games

**Short description (80 max):**
13 arcade and board games. Play the computer, a friend, or chase your high score.

**Full description:**
Neon Serpent is 13 fast, colorful games in one app, with no sign-up.

PLAY A FRIEND
• Neon Cue: pool with a real pull-back shot
• Checkers: jumps, multi-jumps and kings
• Line Up: four in a row
• Gomoku: five in a row
Play the computer on Easy, Medium or Hard, pass the phone back and forth, or open a private room and send a friend the code.

ARCADE
• Neon Serpent: grow without crashing
• Neon Rally: first to seven against the computer
• Neon Storm: dodge everything falling from the sky
• Sky Serpent: one-tap flight through neon gates
• Neon Drop: drop and clear rows of blocks
• Neon Tower: stop each row dead on top of the last
• Neon Mines: three sizes of minefield
• Neon Smash: smash every brick
• Neon Pop: aim, match and pop

Chase your personal best and climb the global leaderboards. Single-player and pass-and-play games work offline.

**Category:** Games > Arcade
**Tags:** Arcade, Board, Casual
**Contact email:** (the address you chose)
**Privacy policy URL:** https://YOUR-SITE/privacy.html

**Graphics, all in `store/`:** `play-icon-512.png`, `play-feature-1024x500.png`, `screenshot-*.png`

## App content

- **Ads:** No ads
- **App access:** All functionality available without special access
- **Target audience:** 13 and over. It's not designed for children.
- **Content rating questionnaire:** Category "Game". No violence, sexual content, profanity, drugs or gambling. Answer **Yes**
  to users interacting with each other: players can see each other's callsigns and moves in private rooms, and callsigns
  appear on global leaderboards. No sharing of location, no purchases.
- **News / government / financial / health / COVID apps:** No
- **Advertising ID:** Not used

## Data safety

**Does the app collect or share user data?** Yes, collected; not shared with third parties (AWS is a service provider).
**Encrypted in transit?** Yes.
**Can users request deletion?** Yes, by email, using the contact on the privacy policy.

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Personal info > Other info (callsign / nickname) | Yes | App functionality | Yes, only for online features |
| App activity > Other actions (scores, moves, game results) | Yes | App functionality | Yes, only for online features |
| Device or other IDs (anonymous guest ID, random player ID) | Yes | App functionality | Yes, only for online features |

The app build has no analytics, ads or crash reporting.

If the build ships with online play OFF, it sends no game data, so answer "No" to collecting data instead.

## Upload

1. Create the app: name above, Game, Free.
2. Turn on Play App Signing when asked (the default).
3. Test and release > Closed testing: create a track, upload the release `.aab`, add at least 12 testers.
4. Ask for production access after 14 days, if your account requires it.

## Build and signing

- Rebuild: `npm run build:app`, then in `android/`, `./gradlew bundleRelease`
- Output: `android/app/build/outputs/bundle/release/app-release.aab`
- Before each upload, raise `versionCode` in `android/app/build.gradle`
- The upload key and its password are in `~/.neon-serpent-android/`, outside git. Back that folder up somewhere private.
  With Play App Signing, Google can reset a lost upload key, but it takes time.
