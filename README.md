<p align="center">
  <img src="icons/logo512.png" width="128" alt="Banish logo">
</p>

<h1 align="center">Banish</h1>
<p align="center"><b>Quick block for TikTok</b>: one click marks a video <i>Not interested</i> and blocks its account.</p>
<p align="center">Idea &amp; design by <b>LeerBox</b></p>

---

## Features
- **One-click cleanup.** Marks the video *Not interested* so TikTok shows less like it, then blocks the account.
- **Buttons in the right places.** They appear wherever accounts show up, and never sit on top of TikTok's own controls.
- **Auto-skip.** Videos from accounts you've already blocked are skipped in the feed.
- **Dimmed comments.** Comments from blocked accounts fade out.
- **Keyboard shortcut.** <kbd>Alt</kbd> + <kbd>B</kbd> blocks the author of the video on screen.
- **Popup.** Settings and a list of recently blocked accounts.

## Where the button appears
| Place | Position |
|---|---|
| For You / Following / video page | Top edge of the video, just left of TikTok's `⋯` button. Expands to "Not interested + Block" on hover. |
| Comments & replies | Small ⊘ next to the username (shows on hover). |
| Profile page | "Block" button next to the `⋯` button in the header. |
| Search results | ⊘ next to the author name on each card. |

## Install
1. Download this repository (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the folder.
5. Reload any open TikTok tab.

## How blocking works
Banish opens the account's profile in a hidden same-origin frame and clicks TikTok's own
`⋯ → Block → Block` buttons. If that fails, it retries in a background tab that closes itself.
"Not interested" uses the native option from the video's `⋯` menu (videos only).
Nothing is sent anywhere else: the list of blocked accounts stays in your browser.

## Notes
- Set TikTok's language to **English**: the block flow finds buttons by their text ("Block" / "Unblock").
- To unblock someone, open their profile on TikTok and press **Unblock**.
- Banish is an independent project and is not affiliated with TikTok or ByteDance.

## Author
Created by **LeerBox**: idea, concept and design.

## License
[MIT](LICENSE) © LeerBox
