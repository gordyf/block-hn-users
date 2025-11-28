# Block HN Users

A Chrome extension for blocking users on Hacker News.

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select this directory

## Usage

**Block a user:** Click `[block]` next to any username in HN comments

**Manage blocked users:** Click the extension icon to:
- Add users manually by username
- View your blocked list
- Unblock individual users
- Import/export your block list as a text file
- Clear all blocks

## How It Works

- **Posts** from blocked users are completely hidden
- **Comments** from blocked users show as `[comment from blocked user]` to preserve discussion flow
- Your block list syncs across Chrome browsers via `chrome.storage.sync`
- Works with infinite scroll and dynamically loaded content

## Privacy

All data is stored in your browser. Nothing is sent to external servers.
