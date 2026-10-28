# Changelog

All notable changes to Banish are listed here.
Each section becomes the notes of its GitHub release.

## [1.2.1] - 2026-10-28

### Fixed
- **LIVE header: the ⊘ button overlapped Follow.** On some streams TikTok renders the share button without its usual identifier, so Banish fell back to placing its button inside Follow's own box. Banish now always goes at the end of the header row, after the streamer's name, Follow and share.

## [1.2.0] - 2026-10-28

Banish now works **everywhere a username appears** on TikTok.

### Added
- **Universal layer.** Banish finds every link to an account on any page and adds the right kind of button. You can switch it off in the popup (**Show everywhere**).
  - **Name links** (Explore cards, follower lists, notifications, the "You may like" panel and more) get a quiet ⊘ next to the name, shown on hover.
  - **Whole-card links** (search **Users** tab, sidebar **Following accounts**) get a round ⊘ at the card's right edge. It sits left of TikTok's own Follow button, never on top of it.
  - Places that already have a hand-tuned button (videos, comments, profiles, LIVE) are skipped, and nested links get a single button, so there are no duplicates.
- **LIVE cards in For You / Following.** The stream preview now reads **LIVE now · Following · ⊘ Banish**. The card shows the streamer's name as plain text, so Banish reads the username from the card's LIVE link.

## [1.1.3] - 2026-10-28

### Added
- **Support for TikTok's new full-width "cinema" player.** In this layout the author, ⋯ and action buttons are shared by whichever video is playing, rather than sitting inside each video. Banish now adds a compact **⊘ Banish** button next to the creator's name and Follow at the bottom left, and uses the shared ⋯ menu for *Not interested*. Auto-skip and Alt + B work there too.

## [1.1.2] - 2026-10-28

Updated for TikTok's late-October redesign.

### Fixed
- **Profile button overlapped the ⋯ button.** TikTok now wraps ⋯ in its own container, and Banish's button landed inside it. It now sits after ⋯, in the same row as Follow, Message and Share.
- **Slower "Not interested".** The video ⋯ menu no longer opens on hover, only on click. Banish now clicks straight away, which saves about a second per block.

### Checked, unchanged
- Feed video button, Block flow on profiles (menu and confirmation dialog), comments, search results, and LIVE (header and chat). Comments now load after you switch the side panel from "You may like" to "Comments"; Banish adds its icons as soon as they appear.

## [1.1.1] - 2026-10-24

Ready for the Chrome Web Store.

### Changed
- **Fewer permissions.** Banish no longer asks for the `tabs` permission, which it never needed. The install prompt now shows a single line: *Read and change your data on www.tiktok.com*.

### Added
- **Privacy policy.** [PRIVACY.md](PRIVACY.md): Banish collects nothing, and your settings and block list stay on your device.

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
