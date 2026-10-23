# Changelog

All notable changes to Banish are listed here.
Each section becomes the notes of its GitHub release.

## [1.1.0] - 2026-10-24

Banish now works on **TikTok LIVE**.

### Added
- **LIVE support.** Block the streamer from the LIVE header (next to the share button), or any chatter from the LIVE chat. Chat names only show display names, so a small page helper (`main.js`) reads each chatter's real @username.

## [1.0.1] - 2026-10-24

Blocking now works: one click marks the video *Not interested* and then blocks its account, usually in about 5 seconds.

### Fixed
- **Block step never ran.** A coding error crashed the hidden profile page every time, so only *Not interested* happened.
- **TikTok's `⋯` menu ignored the extension's clicks.** Clicks now look like real mouse clicks, so the menu opens.
- **The Block confirmation is found reliably.** Banish now uses the dialog's own button ID.
- **The block survives TikTok reloading the page**, and stays reliable when Chrome would otherwise slow down a hidden page.
- **Banish only reports success after TikTok confirms the block.**

### Improved
- **You can see both steps.** On-screen messages show *Not interested* first, then the block in progress.
- **Clear errors.** If something fails, the message names the step that failed.
- **Debug mode for troubleshooting.** Set `localStorage.banishDebug = 1` to see the hidden profile page while it works.

## [1.0.0] - 2026-10-24

The first public release of **Banish**: quick block for TikTok, idea and design by LeerBox.

### Features
- **One-click cleanup.** Marks the video *Not interested*, then blocks the account using TikTok's own buttons.
- **Buttons where accounts appear.** On the video (top edge, next to TikTok's `⋯` button), next to commenters in comments and replies, in the profile header, and on search results.
- **Banish design.** The ban mark from the logo, with cyan and red layers that split apart on hover, plus a branded tooltip and toast.
- **Auto-skip.** Videos from accounts you've already blocked are skipped in the feed.
- **Dimmed comments.** Comments from blocked accounts fade out.
- **Keyboard shortcut.** <kbd>Alt</kbd> + <kbd>B</kbd> blocks the author of the video on screen.
- **Popup.** Settings and a list of recently blocked accounts.

### Known limitations
- TikTok's interface language must be **English**: Banish finds buttons by their text.
