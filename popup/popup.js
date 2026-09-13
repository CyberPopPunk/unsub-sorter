/**
 * Sender Unread Sorter - Popup Controller
 * UI controller bridging Thunderbird MailExtension APIs with the SorterCore engine.
 */

// Import SorterCore functions with safe fallback
const SorterEngine = typeof SorterCore !== "undefined" ? SorterCore : (typeof window !== "undefined" && window.SorterCore ? window.SorterCore : null);
const {
  formatDate,
  groupAndRankSenders,
  parseUnsubscribeHeader,
  isValidHttpUrl,
  isValidMailtoUrl,
  getDomainFromEmail,
  getFilterTermForSender
} = SorterEngine || {};

// Global State
let currentTabId = null;
let currentFolder = null;
let rankedSenders = [];
let allUnreadMessages = [];
let activeFilteredKey = null;
const unsubscribeLinksCache = new Map();

// Custom error for non-mail tab state
class NonMailTabError extends Error {
  constructor(message = "No active Thunderbird mail tab found.") {
    super(message);
    this.name = "NonMailTabError";
  }
}

// DOM Templates
const senderCardTemplate = document.getElementById("sender-card-template");

// DOM Elements: Header & Navigation
const folderNameEl = document.getElementById("folder-name");
const statSendersEl = document.getElementById("stat-senders");
const statUnreadEl = document.getElementById("stat-unread");
const statFolderEl = document.getElementById("stat-folder");

// DOM Elements: List
const senderListEl = document.getElementById("sender-list");

// DOM Elements: States
const loadingState = document.getElementById("loading-state");
const emptyState = document.getElementById("empty-state");
const nonMailState = document.getElementById("non-mail-state");
const errorState = document.getElementById("error-state");
const errorMessageEl = document.getElementById("error-message");
const feedbackBanner = document.getElementById("feedback-banner");
const feedbackText = document.getElementById("feedback-text");

// DOM Elements: Buttons
const btnRefresh = document.getElementById("btn-refresh");
const btnOpenTab = document.getElementById("btn-open-tab");
const btnSortAuthor = document.getElementById("btn-sort-author");
const btnSwitchInbox = document.getElementById("btn-switch-inbox");
const btnRetry = document.getElementById("btn-retry");
const btnRescanEmpty = document.getElementById("btn-rescan-empty");

// Helper: Show transient feedback banner
let feedbackTimeout = null;
function showFeedback(text, durationMs = 3000) {
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  feedbackText.textContent = text;
  feedbackBanner.classList.remove("hidden");
  feedbackTimeout = setTimeout(() => {
    feedbackBanner.classList.add("hidden");
  }, durationMs);
}

// Helper: Create SVG icon safely using createElementNS
function createSvg(viewBox, elements) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  for (const item of elements) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", item.tag);
    for (const [attr, val] of Object.entries(item.attrs)) {
      el.setAttribute(attr, val);
    }
    svg.appendChild(el);
  }
  return svg;
}

// Fetch and cache RFC 2369 List-Unsubscribe information for an individual sender
async function getSenderUnsubscribeInfo(sender) {
  if (unsubscribeLinksCache.has(sender.email)) {
    return unsubscribeLinksCache.get(sender.email);
  }

  const msgId = sender.latestMessageId || (sender.messageIds && sender.messageIds.length > 0 ? sender.messageIds[sender.messageIds.length - 1] : null);
  if (!msgId) {
    unsubscribeLinksCache.set(sender.email, null);
    return null;
  }

  try {
    const fullMsg = await messenger.messages.getFull(msgId);
    if (fullMsg && fullMsg.headers) {
      const unsub = parseUnsubscribeHeader(fullMsg.headers);
      unsubscribeLinksCache.set(sender.email, unsub);
      return unsub;
    }
  } catch (err) {
    console.debug("[Unread Sender Sorter] Header inspection error for", sender.email, err);
  }

  unsubscribeLinksCache.set(sender.email, null);
  return null;
}

const COMMON_WEBMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com"
]);

// Asynchronously populate the unsubscribe button for a sender card
function renderUnsubscribeButton(container, sender, unsub) {
  container.replaceChildren();

  if (unsub && unsub.httpUrl && isValidHttpUrl(unsub.httpUrl)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-action btn-action-unsub";
    btn.title = `1-Click Header Unsubscribe:\n${unsub.httpUrl}`;

    const icon = createSvg("0 0 24 24", [
      { tag: "path", attrs: { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" } },
      { tag: "polyline", attrs: { points: "15 3 21 3 21 9" } },
      { tag: "line", attrs: { x1: "10", y1: "14", x2: "21", y2: "3" } }
    ]);
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(" Unsubscribe ↗"));

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      messenger.tabs.create({ url: unsub.httpUrl }).catch(() => {
        window.open(unsub.httpUrl, "_blank", "noopener,noreferrer");
      });
      showFeedback(`Opening unsubscribe page for ${sender.name || sender.email}...`);
    });

    container.appendChild(btn);
  } else if (unsub && unsub.mailtoUrl && isValidMailtoUrl(unsub.mailtoUrl)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-action btn-action-unsub";
    btn.title = `Send Unsubscribe Email:\n${unsub.mailtoUrl}`;

    const icon = createSvg("0 0 24 24", [
      { tag: "path", attrs: { d: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" } },
      { tag: "polyline", attrs: { points: "22,6 12,13 2,6" } }
    ]);
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(" Unsub Email ↗"));

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(unsub.mailtoUrl, "_blank");
      showFeedback(`Opened unsubscribe email draft`);
    });

    container.appendChild(btn);
  } else {
    const domain = getDomainFromEmail(sender.email);
    if (domain && !COMMON_WEBMAIL_DOMAINS.has(domain)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-action btn-action-search";
      btn.title = `No header link found. Search web for "${domain} unsubscribe"`;

      const icon = createSvg("0 0 24 24", [
        { tag: "circle", attrs: { cx: "11", cy: "11", r: "8" } },
        { tag: "line", attrs: { x1: "21", y1: "21", x2: "16.65", y2: "16.65" } }
      ]);
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(" Search Unsub ↗"));

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const q = encodeURIComponent(`${domain || sender.name} unsubscribe`);
        const searchUrl = `https://www.google.com/search?q=${q}`;
        messenger.tabs.create({ url: searchUrl }).catch(() => {
          window.open(searchUrl, "_blank", "noopener,noreferrer");
        });
      });

      container.appendChild(btn);
    }
  }
}

// Action: Switch to or open Inbox Tab when user is in a non-mail tab
async function switchToInboxTab() {
  try {
    showFeedback("Switching to Inbox...");
    // Look for any existing mail tabs in the current window first, then any window
    let mailTabs = await messenger.mailTabs.query({ currentWindow: true });
    if (!mailTabs || mailTabs.length === 0) {
      mailTabs = await messenger.mailTabs.query({});
    }

    if (mailTabs && mailTabs.length > 0) {
      const targetTab = mailTabs[0];
      const targetTabId = targetTab.id || targetTab.tabId;
      await messenger.tabs.update(targetTabId, { active: true });
      currentTabId = targetTabId;
    } else {
      // Create a mail tab or new tab
      if (messenger.mailTabs && messenger.mailTabs.create) {
        await messenger.mailTabs.create({});
      } else {
        await messenger.tabs.create({});
      }
    }

    // Rescan folder now that inbox tab is switched to
    await scanAndRankFolder();
  } catch (err) {
    console.error("[Unread Sender Sorter] Switch inbox error:", err);
    showFeedback("Could not switch to inbox: " + err.message);
  }
}

// Step 1: Detect Active Mail Folder
async function getActiveFolder() {
  const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new NonMailTabError("No active Thunderbird mail tab found.");
  }
  const tab = tabs[0];
  currentTabId = tab.tabId || tab.id;

  if (messenger.mailTabs.getSelectedFolders) {
    const selectedFolders = await messenger.mailTabs.getSelectedFolders(currentTabId);
    if (selectedFolders && selectedFolders.length > 0) {
      return selectedFolders[0];
    }
  }

  if (tab.displayedFolder) {
    return tab.displayedFolder;
  }

  const accounts = await messenger.accounts.list();
  for (const acc of accounts) {
    if (acc.folders) {
      const inbox = acc.folders.find(f => f.type === "inbox" || f.name.toLowerCase() === "inbox");
      if (inbox) return inbox;
    }
  }

  throw new Error("Could not find an active mail folder or Inbox.");
}

// Step 2: Main Scan and Ranking Routine
async function scanAndRankFolder() {
  try {
    loadingState.classList.remove("hidden");
    senderListEl.classList.add("hidden");
    emptyState.classList.add("hidden");
    nonMailState.classList.add("hidden");
    errorState.classList.add("hidden");

    currentFolder = await getActiveFolder();
    folderNameEl.textContent = currentFolder.name || "Inbox";
    statFolderEl.textContent = currentFolder.name || "Folder";
    statFolderEl.title = `Current Folder: ${currentFolder.name || 'Inbox'}`;

    // Query unread messages
    let page = await messenger.messages.query({
      folderId: currentFolder.id,
      read: false
    });

    allUnreadMessages = [];
    const seenMsgIds = new Set();
    function appendUniqueMessages(msgs) {
      if (!Array.isArray(msgs)) return;
      for (const m of msgs) {
        if (m && m.id) {
          if (!seenMsgIds.has(m.id)) {
            seenMsgIds.add(m.id);
            allUnreadMessages.push(m);
          }
        } else if (m) {
          allUnreadMessages.push(m);
        }
      }
    }

    if (page && page.messages) {
      appendUniqueMessages(page.messages);
      while (page.id) {
        page = await messenger.messages.continueList(page.id);
        if (page.messages && page.messages.length > 0) {
          appendUniqueMessages(page.messages);
        }
      }
    }

    // Check if inbox zero
    if (allUnreadMessages.length === 0) {
      loadingState.classList.add("hidden");
      emptyState.classList.remove("hidden");
      statSendersEl.textContent = "0";
      statUnreadEl.textContent = "0";
      messenger.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
      return;
    }

    // Group and Rank Senders via SorterCore (combines similar names from different email senders)
    rankedSenders = groupAndRankSenders(allUnreadMessages);

    // Update stats & counters
    statSendersEl.textContent = String(rankedSenders.length);
    statUnreadEl.textContent = String(allUnreadMessages.length);

    // Render list
    renderAllSenderList(rankedSenders);

    loadingState.classList.add("hidden");
    messenger.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});

  } catch (err) {
    console.error("[Unread Sender Sorter] Scan error:", err);
    loadingState.classList.add("hidden");
    if (err instanceof NonMailTabError || err.name === "NonMailTabError" || (err.message && err.message.includes("No active Thunderbird mail tab"))) {
      folderNameEl.textContent = "Mail tab required";
      statFolderEl.textContent = "Mail Tab Required";
      nonMailState.classList.remove("hidden");
    } else {
      errorMessageEl.textContent = err.message || "An unexpected error occurred while reading emails.";
      errorState.classList.remove("hidden");
    }
  }
}

// Render Standard "All Senders" Cards using HTML Templates & Safe DOM Methods
function renderAllSenderList(sendersToRender) {
  senderListEl.replaceChildren();

  if (sendersToRender.length === 0) {
    senderListEl.classList.add("hidden");
    return;
  }
  senderListEl.classList.remove("hidden");

  sendersToRender.forEach((sender, index) => {
    const li = document.createElement("li");
    const cardKey = sender.groupKey || sender.email;
    const isActive = activeFilteredKey === cardKey;
    li.className = `sender-card ${isActive ? 'is-active-filter' : ''}`;
    li.dataset.key = cardKey;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("title", `Click to filter inbox to unread emails from ${sender.name || sender.email}`);
    li.appendChild(senderCardTemplate.content.cloneNode(true));

    const rank = index + 1;
    const formattedDate = formatDate(sender.latestDate);

    // Safely assign text content (prevents HTML parsing/injection)
    li.querySelector(".rank-badge").textContent = `#${rank}`;

    const nameEl = li.querySelector(".sender-display-name");
    nameEl.textContent = sender.name;
    nameEl.title = sender.name;

    const emailEl = li.querySelector(".sender-email");
    if (sender.emails && sender.emails.length > 1) {
      emailEl.textContent = `${sender.email} (+${sender.emails.length - 1} more)`;
      emailEl.title = `Combined Addresses (${sender.emails.length}):\n${sender.emails.join("\n")}`;
    } else {
      emailEl.textContent = sender.email;
      emailEl.title = sender.email;
    }

    const unreadPill = li.querySelector(".unread-count-pill");
    unreadPill.title = `${sender.unreadCount} unread emails`;
    li.querySelector(".unread-count-text").textContent = `${sender.unreadCount} unread`;

    const subjectEl = li.querySelector(".snippet-subject");
    subjectEl.textContent = sender.latestSubject;
    subjectEl.title = sender.latestSubject;

    li.querySelector(".snippet-date").textContent = formattedDate;

    const selectBtn = li.querySelector('[data-action="select"]');
    selectBtn.title = `Batch select all ${sender.unreadCount} unread messages from this sender in the inbox`;
    selectBtn.querySelector(".btn-select-text").textContent = `Batch Select (${sender.unreadCount})`;

    // Clicking anywhere on the sender card filters by that sender with the unread flag
    // Clicking again deselects / clears the filter
    li.addEventListener("click", async (e) => {
      if (e.target.closest('[data-action="select"]')) {
        return;
      }
      if (activeFilteredKey === cardKey) {
        await resetQuickFilter();
      } else {
        await filterSenderInInbox(sender);
      }
    });

    // Keyboard support (Enter or Space)
    li.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (!e.target.closest('[data-action="select"]')) {
          e.preventDefault();
          if (activeFilteredKey === cardKey) {
            await resetQuickFilter();
          } else {
            await filterSenderInInbox(sender);
          }
        }
      }
    });

    selectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectSenderMessages(sender);
    });

    // Asynchronously resolve and render unsubscribe button
    const unsubSlot = li.querySelector(".unsub-action-slot");
    if (unsubSlot) {
      getSenderUnsubscribeInfo(sender).then((unsub) => {
        if (!unsubSlot || !li.isConnected) return;
        renderUnsubscribeButton(unsubSlot, sender, unsub);
      });
    }

    senderListEl.appendChild(li);
  });
}


// Action: Filter Thunderbird Native Thread Pane with Unread Flag
async function filterSenderInInbox(sender) {
  try {
    if (!currentTabId) {
      const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) currentTabId = tabs[0].tabId || tabs[0].id;
    }

    activeFilteredKey = sender.groupKey || sender.email;

    // Update active highlight on all visible sender cards
    document.querySelectorAll(".sender-card").forEach(card => {
      if (card.dataset.key === activeFilteredKey) {
        card.classList.add("is-active-filter");
      } else {
        card.classList.remove("is-active-filter");
      }
    });

    // Compute optimal filter term that matches all messages in this group
    const filterTerm = getFilterTermForSender ? getFilterTermForSender(sender) : (sender.email || "");

    await messenger.mailTabs.setQuickFilter(currentTabId, {
      show: true,
      unread: true,
      text: {
        text: filterTerm,
        author: true
      }
    });

    // Also select all messages from this sender in the thread pane so all are highlighted
    if (sender.messageIds && sender.messageIds.length > 0) {
      messenger.mailTabs.setSelectedMessages(currentTabId, sender.messageIds).catch((err) => {
        console.debug("Selected messages error:", err);
      });
    }

    const count = sender.unreadCount || (sender.messageIds ? sender.messageIds.length : 0);
    const threadHint = count > 1 ? " (expand thread arrows if grouped)" : "";
    showFeedback(`Inbox filtered to ${count} unread email(s) from: ${sender.name || sender.email}${threadHint}`);
  } catch (err) {
    console.error("Filter error:", err);
    showFeedback("Failed to set quick filter: " + err.message);
  }
}

// Action: Select All Messages from this Sender
async function selectSenderMessages(sender) {
  try {
    if (!currentTabId) {
      const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) currentTabId = tabs[0].tabId || tabs[0].id;
    }

    const filterTerm = getFilterTermForSender ? getFilterTermForSender(sender) : (sender.email || "");
    await messenger.mailTabs.setQuickFilter(currentTabId, {
      show: true,
      unread: true,
      text: {
        text: filterTerm,
        author: true
      }
    });

    await messenger.mailTabs.setSelectedMessages(currentTabId, sender.messageIds);
    showFeedback(`Batch selected all ${sender.messageIds.length} message(s) in inbox`);
  } catch (err) {
    console.error("Select error:", err);
    showFeedback("Failed to select messages: " + err.message);
  }
}

// Action: Reset Quick Filter
async function resetQuickFilter() {
  try {
    if (!currentTabId) {
      const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) currentTabId = tabs[0].tabId || tabs[0].id;
    }

    activeFilteredKey = null;
    document.querySelectorAll(".sender-card").forEach(card => {
      card.classList.remove("is-active-filter");
    });

    await messenger.mailTabs.setQuickFilter(currentTabId, {
      unread: false,
      text: {
        text: "",
        author: false
      }
    });
    showFeedback("Quick filter cleared");
  } catch (err) {
    console.error("Reset filter error:", err);
    showFeedback("Failed to clear filter: " + err.message);
  }
}

// Action: Set Native Inbox Sort to Author
async function sortInboxByAuthor() {
  try {
    if (!currentTabId) {
      const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) currentTabId = tabs[0].tabId || tabs[0].id;
    }

    await messenger.mailTabs.update(currentTabId, {
      sortType: "author",
      sortOrder: "ascending"
    });
    showFeedback("Native inbox sorted alphabetically by author");
  } catch (err) {
    console.error("Sort author error:", err);
    showFeedback("Failed to sort inbox: " + err.message);
  }
}

// Action Listeners
btnRefresh.addEventListener("click", scanAndRankFolder);
btnRetry.addEventListener("click", scanAndRankFolder);
btnRescanEmpty.addEventListener("click", scanAndRankFolder);
btnSwitchInbox.addEventListener("click", switchToInboxTab);
btnSortAuthor.addEventListener("click", sortInboxByAuthor);

// Open in Full Tab
btnOpenTab.addEventListener("click", async () => {
  try {
    await messenger.tabs.create({ url: "popup/popup.html?tab=true" });
    window.close();
  } catch (err) {
    console.error("Tab create error:", err);
  }
});

// Initialize on popup load
document.addEventListener("DOMContentLoaded", async () => {
  if (window.location.search.includes("tab=true") || window.innerWidth > 550) {
    document.body.classList.add("tab-mode");
    document.documentElement.classList.add("tab-mode");
  }

  await scanAndRankFolder();
});
