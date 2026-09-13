const { describe, it } = require("node:test");
const assert = require("node:assert");
const SorterCore = require("../popup/core.js");

describe("Workflow Integration: End-to-End Mailbox Scan & Processing", () => {
  // Setup Mock Thunderbird API Environment
  function createMockThunderbirdEnvironment() {
    const storageStore = new Map();

    const mockMessages = [
      // Spammer 1: 4 messages with List-Unsubscribe link
      { id: "m1", author: "Spam Deals <deals@spam.com>", date: "2026-09-01T10:00:00Z", subject: "Deal 1", read: false },
      { id: "m2", author: "Spam Deals <deals@spam.com>", date: "2026-09-02T10:00:00Z", subject: "Deal 2", read: false },
      { id: "m3", author: "Spam Deals <deals@spam.com>", date: "2026-09-03T10:00:00Z", subject: "Deal 3", read: false },
      { id: "m4", author: "Spam Deals <deals@spam.com>", date: "2026-09-04T10:00:00Z", subject: "Deal 4", read: false },

      // Spammer 2: 3 messages with mailto unsubscribe
      { id: "m5", author: "News Alert <alert@news.org>", date: "2026-09-05T12:00:00Z", subject: "News 1", read: false },
      { id: "m6", author: "News Alert <alert@news.org>", date: "2026-09-06T12:00:00Z", subject: "News 2", read: false },
      { id: "m7", author: "News Alert <alert@news.org>", date: "2026-09-07T12:00:00Z", subject: "News 3", read: false },

      // Normal Friend: 1 message, no unsubscribe
      { id: "m8", author: "Alice <alice@friend.com>", date: "2026-09-08T08:00:00Z", subject: "Hello", read: false }
    ];

    const mockFullMessages = {
      m4: {
        id: "m4",
        headers: {
          "list-unsubscribe": ["<https://spam.com/unsubscribe?user=123>"]
        }
      },
      m7: {
        id: "m7",
        headers: {
          "list-unsubscribe": ["<mailto:unsubscribe@news.org?subject=optout>"]
        }
      },
      m8: {
        id: "m8",
        headers: {
          "subject": ["Hello"]
        }
      }
    };

    let selectedMessageIds = [];

    const messenger = {
      messages: {
        query: async () => ({
          id: "page-1",
          messages: mockMessages.slice(0, 5)
        }),
        continueList: async (pageId) => {
          if (pageId === "page-1") {
            return { id: null, messages: mockMessages.slice(5) };
          }
          return { id: null, messages: [] };
        },
        getFull: async (msgId) => mockFullMessages[msgId] || { id: msgId, headers: {} }
      },
      mailTabs: {
        setSelectedMessages: async (tabId, ids) => {
          selectedMessageIds = [...ids];
          return true;
        }
      },
      storage: {
        local: {
          get: async (key) => ({ [key]: storageStore.get(key) || [] }),
          set: async (obj) => {
            for (const [k, v] of Object.entries(obj)) {
              storageStore.set(k, v);
            }
          }
        }
      },
      getSelectedMessageIds: () => selectedMessageIds
    };

    return { messenger, mockMessages };
  }

  it("simulates full lifecycle: pagination, aggregation, ranking, header detection, and batch select", async () => {
    const { messenger } = createMockThunderbirdEnvironment();

    // 1. Fetch all unread messages with pagination
    let page = await messenger.messages.query();
    const allMessages = [...page.messages];
    while (page.id) {
      page = await messenger.messages.continueList(page.id);
      if (page.messages) allMessages.push(...page.messages);
    }
    assert.strictEqual(allMessages.length, 8);

    // 2. Aggregate and Rank
    const ranked = SorterCore.groupAndRankSenders(allMessages);
    assert.strictEqual(ranked.length, 3);

    // Rank 1: deals@spam.com (4 unread)
    assert.strictEqual(ranked[0].email, "deals@spam.com");
    assert.strictEqual(ranked[0].unreadCount, 4);
    assert.strictEqual(ranked[0].latestMessageId, "m4");

    // Rank 2: alert@news.org (3 unread)
    assert.strictEqual(ranked[1].email, "alert@news.org");
    assert.strictEqual(ranked[1].unreadCount, 3);
    assert.strictEqual(ranked[1].latestMessageId, "m7");

    // Rank 3: alice@friend.com (1 unread)
    assert.strictEqual(ranked[2].email, "alice@friend.com");
    assert.strictEqual(ranked[2].unreadCount, 1);

    // 3. Filter Egregious Offenders with threshold >= 3
    const offenders = SorterCore.filterEgregiousOffenders(ranked, 3);
    assert.strictEqual(offenders.length, 2);
    assert.strictEqual(offenders[0].email, "deals@spam.com");
    assert.strictEqual(offenders[1].email, "alert@news.org");

    // 4. Header inspection for Unsubscribe links
    const unsubInfoMap = new Map();
    for (const off of offenders) {
      const fullMsg = await messenger.messages.getFull(off.latestMessageId);
      const unsub = SorterCore.parseUnsubscribeHeader(fullMsg.headers);
      unsubInfoMap.set(off.email, unsub);
    }

    const spamUnsub = unsubInfoMap.get("deals@spam.com");
    assert.strictEqual(spamUnsub.httpUrl, "https://spam.com/unsubscribe?user=123");

    const newsUnsub = unsubInfoMap.get("alert@news.org");
    assert.strictEqual(newsUnsub.mailtoUrl, "mailto:unsubscribe@news.org?subject=optout");

    // 5. Batch select all messages for deals@spam.com
    await messenger.mailTabs.setSelectedMessages(1, ranked[0].messageIds);
    assert.deepStrictEqual(messenger.getSelectedMessageIds(), ["m1", "m2", "m3", "m4"]);

    // 6. Mark deals@spam.com as unsubscribed and save to storage
    const unsubscribedSet = new Set(["deals@spam.com"]);
    await messenger.storage.local.set({ unsubscribedSenders: Array.from(unsubscribedSet) });

    const loadedData = await messenger.storage.local.get("unsubscribedSenders");
    assert.deepStrictEqual(loadedData.unsubscribedSenders, ["deals@spam.com"]);

    // 7. Generate markdown export
    const markdown = SorterCore.formatUnsubscribeListMarkdown({
      offenders,
      folderName: "Inbox",
      threshold: 3,
      unsubscribedSet,
      unsubInfoMap
    });

    assert.ok(markdown.includes("`deals@spam.com` | **4** | ✅ Unsubscribed | [1-Click Unsubscribe Link](https://spam.com/unsubscribe?user=123)"));
    assert.ok(markdown.includes("`alert@news.org` | **3** | ⏳ Pending | Mailto: mailto:unsubscribe@news.org?subject=optout"));
  });

  it("applies boolean OR filter when filtering multi-email aggregated senders in inbox", async () => {
    let appliedFilter = null;
    const messenger = {
      mailTabs: {
        setQuickFilter: async (tabId, properties) => {
          appliedFilter = { tabId, properties };
          return true;
        }
      }
    };

    // Simulated multi-email sender card (e.g. Patreon)
    const patreonSender = {
      name: "Patreon",
      email: "no-reply@patreon.com",
      emails: ["no-reply@patreon.com", "bingo@patreon.com", "creator-news@patreon.com"],
      unreadCount: 12,
      messageIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]
    };

    const filterTerm = SorterCore.getFilterTermForSender(patreonSender);
    assert.strictEqual(
      filterTerm,
      "no-reply@patreon.com | bingo@patreon.com | creator-news@patreon.com"
    );

    // Apply quick filter
    await messenger.mailTabs.setQuickFilter(1, {
      show: true,
      unread: true,
      text: {
        text: filterTerm,
        author: true
      }
    });

    assert.deepStrictEqual(appliedFilter, {
      tabId: 1,
      properties: {
        show: true,
        unread: true,
        text: {
          text: "no-reply@patreon.com | bingo@patreon.com | creator-news@patreon.com",
          author: true
        }
      }
    });
  });
});

