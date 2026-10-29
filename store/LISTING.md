# Chrome Web Store listing — Banish

## Store listing tab

**Name** (from manifest): Banish – Quick block for TikTok

**Summary** (max 132 chars, from manifest description):
One-click 'Not interested' + Block for TikTok accounts — on videos, comments, profiles and search. Created by LeerBox.

**Category:** Social & Communication
**Language:** English

**Description:**
```
Banish cleans up your TikTok in one click.

See a video you never want to see again? Press the Banish button. It marks the video "Not interested", so TikTok shows you less like it, and then blocks the account that posted it. Two steps, one click, done in a few seconds.

WHERE YOU'LL FIND IT
• On every video: a small glass button on the top edge, next to TikTok's own ⋯ menu
• In comments and replies: a quiet ⊘ next to each username (appears on hover)
• On profiles: a Banish button next to the ⋯ menu
• In search results: next to each author
• On TikTok LIVE: next to the streamer's share button, and next to every name in the LIVE chat

SMART BY DESIGN
• Auto-skip: videos from accounts you've already banished are skipped in your feed
• Dimmed comments from blocked accounts
• Keyboard shortcut: Alt + B blocks the author of the video on screen
• On-screen progress for each step, and clear messages if something goes wrong
• A popup with your settings and a list of recently blocked accounts

PRIVATE
Banish collects nothing. It has no servers, analytics or trackers. It works by pressing TikTok's own buttons in your own logged-in session, and your settings and block list stay on your device.

Note: set TikTok's language to English. Banish finds TikTok's buttons by their text.

Banish is an independent project by LeerBox and isn't affiliated with TikTok or ByteDance.
Source code: https://github.com/LeerBox/banish
```

**Graphic assets** (in `store/`):
- Store icon 128×128: `icons/icon128.png`
- Screenshots 1280×800: `store/real-1.png` … `store/real-5.png` (real, anonymized captures; sources in `store/src/real-*.html` + `store/src/real/`). Older illustrated set: `store/screenshot-1..3.png`
- Small promo tile 440×280: `store/promo-small.png`
- Marquee promo tile 1400×560 (optional): `store/promo-marquee.png`

**Homepage URL:** https://github.com/LeerBox/banish
**Support URL:** https://github.com/LeerBox/banish/issues

## Privacy practices tab

**Single purpose:**
```
Banish lets users quickly remove unwanted TikTok content: one click marks a video "Not interested" and blocks the account that posted it, using TikTok's own buttons on tiktok.com.
```

**Permission justification — storage:**
```
Saves the user's settings (for example "Mark Not interested first") and a local list of accounts the user blocked with Banish, shown in the popup. Data stays on the device.
```

**Host permission justification — https://www.tiktok.com/*:**
```
Banish adds its block button to TikTok pages (videos, comments, profiles, search, LIVE) and, when the user presses it, clicks TikTok's own "Not interested" and "Block" buttons on tiktok.com in the user's session. It runs on no other site.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** don't tick any data type. Banish collects no user data.
Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/LeerBox/banish/blob/main/PRIVACY.md

## Distribution tab
**Visibility:** Public
**Regions:** All regions
