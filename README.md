# Sender Unread Sorter for Mozilla Thunderbird

A modern **Manifest V3 MailExtension** for Mozilla Thunderbird (compatible with Thunderbird 115 Supernova, 128 ESR Nebula, and 155+) that sorts and ranks your inbox senders by the number of unread emails.

---

## Features

- **Rank Senders by Unread Count**: Instantly analyzes your active Inbox (or any selected folder), groups emails by sender, and ranks senders from the most unread emails to the least.
- **Combined Similar Sender Names**: Intelligently combines different email senders sharing the same brand or contact name (e.g. `Uber <receipts@uber.com>` and `Uber Support <support@uber.com>`) into a single unified card with combined unread counts and message IDs.
- **Boolean OR Quick Filter**: Clicking a combined sender card automatically activates Thunderbird's native Quick Filter with a boolean OR expression (`email1 | email2`), ensuring all related unread messages appear together in the thread pane.
- **Click-to-Filter Unread with Toggle**: Click any sender card to immediately filter Thunderbird's native thread pane to unread messages from that sender. Click again to turn the filter off.
- **1-Click Header Unsubscribe**: Inspects message headers (`List-Unsubscribe` / RFC 2369) and displays an **"Unsubscribe ↗"** button directly on the card to open the unsubscribe page in 1 click.
- **Batch Select in Inbox**: Click **"Batch Select (N)"** to highlight and select all unread messages from a sender across all their merged addresses in your thread pane for quick batch action (archive, delete, mark read, move).
- **Inbox Tab Guidance**: Clean and friendly notification when opening the popup outside a mail tab, with a 1-click **"Go to Inbox"** button to automatically switch to your Inbox tab.
- **Real-Time Badge Counter**: Displays the number of unique senders with unread emails on the toolbar button icon.
- **Native Inbox Sorting**: Quick shortcut button in the header to sort Thunderbird's native thread pane alphabetically by author.
- **Inbox Zero Indicator**: Clear visual status when all emails in the current folder are read.
- **Expandable UI**: Can be used as a convenient toolbar popup or opened as a full standalone Thunderbird tab.

---

## Project Structure

```
unread-sender-sorter/
├── manifest.json         # Manifest V3 extension configuration and permissions
├── background.js         # Background script managing badge indicators and event listeners
├── package.json          # Test runner and build scripts (npm test, npm run lint)
├── build.py              # Packaging script guaranteeing standards-compliant POSIX paths
├── popup/
│   ├── popup.html        # UI structure with secure HTML templates
│   ├── popup.css         # Thunderbird-styled CSS with automatic dark & light mode
│   ├── core.js           # Pure semantic engine (UMD module: parsing, ranking, export)
│   └── popup.js          # Controller bridging Thunderbird WebExtension APIs and UI
├── tests/                # TDD Automated Test Suite (49 passing tests across 11 suites)
│   ├── author_parser.test.js
│   ├── unsubscribe_parser.test.js
│   ├── ranking_and_aggregation.test.js
│   ├── offenders_filter.test.js
│   ├── markdown_export.test.js
│   └── workflow_integration.test.js
├── icons/                # High-res extension icons (32px, 64px, 128px)
├── .gitignore            # Git ignore rules for node, logs, and OS files
├── LICENSE               # MIT License
├── unread-sender-sorter.xpi # Validated, ready-to-install extension package
└── README.md             # Documentation and usage guide
```

---

## Automated TDD Testing

The project includes an automated test suite verifying all semantic and business logic:

```bash
npm test
# or: node --test tests/**/*.test.js
```

All 49 unit and integration tests execute with zero external test dependencies using Node.js's built-in `node:test` and `node:assert` runner.

---

## How to Install & Test in Thunderbird

### Method 1: Load as Temporary Add-on (Recommended for Testing & Development)

1. Open **Thunderbird**.
2. Press `Alt` to reveal the menu bar (if hidden), then go to **Tools** > **Developer Tools** > **Debug Add-ons**.
   - *Alternatively, open a new tab and type `about:debugging` in the address bar.*
3. In the top-right corner, click **"Load Temporary Add-on..."**.
4. Browse to the directory where you cloned or extracted this repository.
5. Select the `manifest.json` file and click **Open**.
6. The extension is now loaded! You will see an icon in your Thunderbird toolbar titled **"Sort Senders by Unread Emails"**.

> **Tip**: If you do not see the icon on your main toolbar:
> 1. Right-click the Thunderbird toolbar and choose **Customize...**.
> 2. Find **"Sort Senders by Unread Emails"** and drag it onto your toolbar.

---

### Method 2: Install the Packaged `.xpi` File (Permanent Install)

The project includes a pre-built `unread-sender-sorter.xpi` file in the root directory.

1. Open **Thunderbird**.
2. Press `Ctrl + Shift + A` (or open the **Add-ons and Themes** manager).
3. Click the **Gear icon (⚙️)** next to "Manage Your Extensions".
4. Select **"Install Add-on From File..."**.
5. Select `unread-sender-sorter.xpi` from the root of this project.
6. Click **Add** to confirm installation.

---

## Rebuilding the `.xpi` Package

If you modify any files, you can repackage the `.xpi` file at any time with standards-compliant POSIX paths using the included build script:

```bash
python build.py
```

To validate the package against Mozilla's add-on linter:

```bash
npm run lint
```

---

## Security & Privacy Policy

### 1. 100% Local Processing (Zero Telemetry)
- All mailbox scanning, author parsing, sender aggregation, and ranking algorithms run **strictly in-memory on your local device**.
- The extension contains **zero network transmission code** (`fetch`, `XMLHttpRequest`, WebSockets, or analytics beacons).
- The extension explicitly declares `"data_collection_permissions": { "required": ["none"] }` in accordance with Mozilla's data disclosure policies.

### 2. Read-Only Mailbox Permissions
- Requests only `messagesRead` and `accountsRead` to read message metadata (`author`, `date`, `subject`, `read`, `id`) and identify active folders.
- **Does not request `messagesModify` or deletion permissions**: The add-on cannot modify, delete, or send emails on your behalf.

### 3. Safe Link & Protocol Handling
- RFC 2369 `List-Unsubscribe` headers are validated against strict URL specifications. Dangerous protocols (`javascript:`, `data:`, `file:`) are rejected.
- External links opened in browser tabs always include `noopener,noreferrer` to prevent reverse tabnabbing.

---

## Technical Details

### 1. Manifest V3 & Minimal Permissions
- `messagesRead`: Query message headers (`author`, `date`, `subject`, `read`, `id`).
- `accountsRead`: Identify accounts and inbox folders.
- `mailTabs`: Control Thunderbird's active mail view (`setQuickFilter`, `setSelectedMessages`, `update`).
- `tabs`: Query current mail tab state.
- `storage`: Retain user preferences and cached folder states.

### 2. Message Retrieval & Pagination
Large mailboxes contain thousands of messages. The extension uses the `messenger.messages.query({ folderId, read: false })` API and paginates through `messenger.messages.continueList(id)` so it remains fast without freezing Thunderbird or overwhelming memory.

### 3. Native Integration
- Uses `messenger.mailTabs.setQuickFilter(tabId, { show: true, unread: true, text: { text: filterTerm, author: true } })` to dynamically filter Thunderbird's native thread pane in real-time.
- Uses `messenger.mailTabs.setSelectedMessages(tabId, messageIds)` to highlight matching emails in the native message table.

---

## License

This project is licensed under the [MIT License](LICENSE).
