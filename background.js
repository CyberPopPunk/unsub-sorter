/**
 * Sender Unread Sorter - Background Script
 * Listens for mail events and manages toolbar badge indicators.
 */

// Initialize badge appearance
async function initBadge() {
  try {
    if (messenger.action && messenger.action.setBadgeBackgroundColor) {
      await messenger.action.setBadgeBackgroundColor({ color: "#eb3b5a" });
    }
    await updateBadgeForCurrentFolder();
  } catch (err) {
    console.warn("[Unread Sender Sorter] Badge init warning:", err);
  }
}

// Update the badge with the count of unread senders or unread emails
async function updateBadgeForCurrentFolder() {
  try {
    const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    const activeTab = tabs[0];
    let folder = null;

    if (messenger.mailTabs.getSelectedFolders) {
      const selected = await messenger.mailTabs.getSelectedFolders(activeTab.tabId || activeTab.id);
      if (selected && selected.length > 0) {
        folder = selected[0];
      }
    }
    if (!folder && activeTab.displayedFolder) {
      folder = activeTab.displayedFolder;
    }

    if (!folder) {
      await messenger.action.setBadgeText({ text: "" });
      return;
    }

    // Query unread messages in this folder
    const page = await messenger.messages.query({
      folderId: folder.id,
      read: false
    });

    const senders = new Set();
    if (page && page.messages) {
      for (const msg of page.messages) {
        if (msg.author) {
          senders.add(msg.author.toLowerCase());
        }
      }
    }

    const count = senders.size;
    const badgeText = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    await messenger.action.setBadgeText({ text: badgeText });
    await messenger.action.setTitle({
      title: count > 0
        ? `Unread Sorter: ${count} sender${count === 1 ? '' : 's'} with unread emails in "${folder.name}"`
        : `Unread Sorter: No unread emails in "${folder.name}"`
    });
  } catch (err) {
    console.debug("[Unread Sender Sorter] Could not update badge:", err);
  }
}

// Event Listeners
messenger.runtime.onInstalled.addListener(() => {
  initBadge();
});

messenger.runtime.onStartup.addListener(() => {
  initBadge();
});

// Update badge when folder view changes
if (messenger.mailTabs && messenger.mailTabs.onDisplayedFolderChanged) {
  messenger.mailTabs.onDisplayedFolderChanged.addListener((tab, folder) => {
    updateBadgeForCurrentFolder();
  });
}

// Update badge on new mail received
if (messenger.messages && messenger.messages.onNewMailReceived) {
  messenger.messages.onNewMailReceived.addListener(() => {
    updateBadgeForCurrentFolder();
  });
}

// Update badge when messages are read/unread/flagged/deleted
if (messenger.messages && messenger.messages.onUpdated) {
  messenger.messages.onUpdated.addListener(() => {
    updateBadgeForCurrentFolder();
  });
}

// Handle runtime messages from the popup or other parts
messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "REFRESH_BADGE") {
    updateBadgeForCurrentFolder().then(() => sendResponse({ success: true }));
    return true; // Async response
  }
});

// Run initial badge setup
initBadge();
