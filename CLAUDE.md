# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Manifest V3 extension that blocks users on Hacker News (news.ycombinator.com). The extension has two main components:

1. **Content Script** (content.js) - Runs on all HN pages, handles blocking UI and content hiding
2. **Popup Interface** (popup.html/js/css) - Management interface for the blocked users list

## Development Workflow

### Testing the Extension

1. Load the extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the project directory

2. After making changes:
   - For content script changes: Reload the HN page
   - For popup changes: Close and reopen the popup
   - For manifest changes: Click the reload icon on the extension card at `chrome://extensions/`

### No Build Process

This extension uses vanilla JavaScript with no build step. Edit the files directly and reload to test changes.

## Architecture

### Data Flow

- Blocked users list stored in `chrome.storage.sync` as an array of usernames
- Content script loads the list on page load and observes storage changes
- Popup and content script stay in sync via storage change listeners

### Content Hiding Behavior

**Posts (submissions):** Completely hidden using `display: none` on the post row and metadata row.

**Comments:** Preserved in the DOM to maintain discussion flow, but:
- Username replaced with `[blocked user]`
- Comment text replaced with `[comment from blocked user]`
- Comment row styled with reduced opacity (`.blocked-comment` class)

### Block Button Placement

Block buttons `[block]` appear ONLY next to usernames in comments (detected via `tr.comtr` parent), not on story submissions. This is intentional design to avoid cluttering the main story list.

### Dynamic Content Handling

A MutationObserver watches for DOM changes to handle:
- Infinite scroll loading new comments/posts
- Dynamic content inserted via AJAX
- "More comments" expansion

## Key Implementation Details

### HN DOM Structure

The extension relies on HN's specific DOM classes:
- `a.hnuser` - Username links
- `tr.comtr` - Comment rows
- `tr.athing` - Post/story rows
- `.commtext` - Comment text container
- `.subtext` - Post metadata (points, age, etc.)

### Import/Export Format

The import/export feature uses plain text files with one username per line. Import deduplicates against the existing blocked list using a Set.

### Storage Sync

Uses `chrome.storage.sync` (not `local`) so the blocked list syncs across the user's Chrome browsers when signed in.

## Extension Permissions

- `storage` - Required for `chrome.storage.sync` API
- `host_permissions: ["https://news.ycombinator.com/*"]` - Required for content script injection

No icon files are used; Chrome displays a default extension icon.
