const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  groupAndRankSenders,
  normalizeSenderName,
  getBaseDomainName,
  getSenderGroupKey,
  chooseBetterSenderName,
  getFilterTermForSender
} = require("../popup/core.js");

describe("Semantic Logic: groupAndRankSenders()", () => {
  it("correctly groups messages from the same sender by normalized email", () => {
    const rawMessages = [
      { id: "1", author: "Store Deals <deals@store.com>", date: "2026-09-10T10:00:00Z", subject: "Sale 1" },
      { id: "2", author: "Store Deals <DEALS@STORE.COM>", date: "2026-09-11T12:00:00Z", subject: "Sale 2" },
      { id: "3", author: "<deals@store.com>", date: "2026-09-12T14:00:00Z", subject: "Sale 3 (Latest)" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].email, "deals@store.com");
    assert.strictEqual(ranked[0].unreadCount, 3);
    assert.deepStrictEqual(ranked[0].messageIds, ["1", "2", "3"]);
    assert.strictEqual(ranked[0].latestSubject, "Sale 3 (Latest)");
    assert.strictEqual(ranked[0].latestMessageId, "3");
  });

  it("combines similar names from different email senders into one card (e.g. Uber)", () => {
    const rawMessages = [
      { id: "u1", author: "Uber <receipts@uber.com>", date: "2026-09-10T08:00:00Z", subject: "Your Wednesday morning trip" },
      { id: "u2", author: "Uber Support <support@uber.com>", date: "2026-09-11T10:00:00Z", subject: "Response to your support ticket" },
      { id: "u3", author: "Uber <newsletter@uber.com>", date: "2026-09-12T12:00:00Z", subject: "Uber Eats promo" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 1, "All Uber emails should be combined into a single card");
    assert.strictEqual(ranked[0].name, "Uber");
    assert.strictEqual(ranked[0].unreadCount, 3);
    assert.deepStrictEqual(ranked[0].messageIds, ["u1", "u2", "u3"]);
    assert.strictEqual(ranked[0].emails.length, 3);
    assert.ok(ranked[0].emails.includes("receipts@uber.com"));
    assert.ok(ranked[0].emails.includes("support@uber.com"));
    assert.ok(ranked[0].emails.includes("newsletter@uber.com"));
    assert.strictEqual(ranked[0].latestSubject, "Uber Eats promo");
  });

  it("combines brand variations and domain suffixes into one card (e.g. Amazon.com vs Amazon)", () => {
    const rawMessages = [
      { id: "a1", author: "Amazon.com <orders@amazon.com>", date: "2026-09-01T00:00:00Z", subject: "Order Placed" },
      { id: "a2", author: "Amazon <shipment@amazon.com>", date: "2026-09-02T00:00:00Z", subject: "Order Shipped" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].unreadCount, 2);
    assert.deepStrictEqual(ranked[0].emails.sort(), ["orders@amazon.com", "shipment@amazon.com"].sort());
  });

  it("combines prefix variations (e.g. The New York Times vs New York Times)", () => {
    const rawMessages = [
      { id: "ny1", author: "The New York Times <news@nytimes.com>", date: "2026-09-01T00:00:00Z", subject: "Breaking News" },
      { id: "ny2", author: "New York Times <billing@nytimes.com>", date: "2026-09-02T00:00:00Z", subject: "Subscription Invoice" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].unreadCount, 2);
  });

  it("does NOT merge generic senders across different domains (e.g. Support for Apple vs Spotify)", () => {
    const rawMessages = [
      { id: "ap1", author: "Support <support@apple.com>", date: "2026-09-01T00:00:00Z", subject: "Apple ID" },
      { id: "sp1", author: "Support <support@spotify.com>", date: "2026-09-02T00:00:00Z", subject: "Spotify Playlist" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 2, "Generic 'Support' on different domains must remain separate cards");
    const emails = ranked.map(r => r.email);
    assert.ok(emails.includes("support@apple.com"));
    assert.ok(emails.includes("support@spotify.com"));
  });

  it("ranks senders descending by unread email count", () => {
    const rawMessages = [
      { id: "1", author: "Newsletter A <a@news.com>", date: "2026-09-01T00:00:00Z", subject: "A1" },
      { id: "2", author: "Newsletter B <b@news.com>", date: "2026-09-01T00:00:00Z", subject: "B1" },
      { id: "3", author: "Newsletter B <b@news.com>", date: "2026-09-02T00:00:00Z", subject: "B2" },
      { id: "4", author: "Newsletter B <b@news.com>", date: "2026-09-03T00:00:00Z", subject: "B3" },
      { id: "5", author: "Newsletter C <c@news.com>", date: "2026-09-01T00:00:00Z", subject: "C1" },
      { id: "6", author: "Newsletter C <c@news.com>", date: "2026-09-02T00:00:00Z", subject: "C2" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 3);
    // B has 3 unread -> Rank #1
    assert.strictEqual(ranked[0].email, "b@news.com");
    assert.strictEqual(ranked[0].unreadCount, 3);
    // C has 2 unread -> Rank #2
    assert.strictEqual(ranked[1].email, "c@news.com");
    assert.strictEqual(ranked[1].unreadCount, 2);
    // A has 1 unread -> Rank #3
    assert.strictEqual(ranked[2].email, "a@news.com");
    assert.strictEqual(ranked[2].unreadCount, 1);
  });

  it("breaks ties using latestDate (most recent email first)", () => {
    const rawMessages = [
      // Sender X has 2 unread, latest on Sept 5
      { id: "x1", author: "Sender X <x@test.com>", date: "2026-09-01T00:00:00Z", subject: "Old X" },
      { id: "x2", author: "Sender X <x@test.com>", date: "2026-09-05T00:00:00Z", subject: "New X" },

      // Sender Y has 2 unread, latest on Sept 10
      { id: "y1", author: "Sender Y <y@test.com>", date: "2026-09-01T00:00:00Z", subject: "Old Y" },
      { id: "y2", author: "Sender Y <y@test.com>", date: "2026-09-10T00:00:00Z", subject: "New Y" }
    ];

    const ranked = groupAndRankSenders(rawMessages);
    assert.strictEqual(ranked.length, 2);
    // Both have unreadCount = 2, but Y's latest email is Sept 10 vs X's Sept 5
    assert.strictEqual(ranked[0].email, "y@test.com");
    assert.strictEqual(ranked[1].email, "x@test.com");
  });

  it("handles empty or invalid message arrays gracefully", () => {
    assert.deepStrictEqual(groupAndRankSenders([]), []);
    assert.deepStrictEqual(groupAndRankSenders(null), []);
    assert.deepStrictEqual(groupAndRankSenders([null, undefined]), []);
  });
});

describe("Semantic Logic: Canonical Name and Domain Helpers", () => {
  it("normalizes sender names by stripping articles, corporate suffixes, and team terms", () => {
    assert.strictEqual(normalizeSenderName("The New York Times"), "new york times");
    assert.strictEqual(normalizeSenderName("Amazon.com"), "amazon");
    assert.strictEqual(normalizeSenderName("Uber Receipts"), "uber");
    assert.strictEqual(normalizeSenderName("Apple Support"), "apple");
    assert.strictEqual(normalizeSenderName("GitHub, Inc."), "github");
    assert.strictEqual(normalizeSenderName("Doe, Jane"), "jane doe");
  });

  it("extracts base domain names from simple and compound domains", () => {
    assert.strictEqual(getBaseDomainName("uber.com"), "uber");
    assert.strictEqual(getBaseDomainName("mail.google.com"), "google");
    assert.strictEqual(getBaseDomainName("amazon.co.uk"), "amazon");
    assert.strictEqual(getBaseDomainName("news.bbc.co.uk"), "bbc");
  });

  it("computes sender grouping keys accurately", () => {
    const key1 = getSenderGroupKey({ name: "Uber", email: "receipts@uber.com" });
    const key2 = getSenderGroupKey({ name: "Uber Support", email: "support@uber.com" });
    assert.strictEqual(key1, key2, "Both Uber receipts and support should produce the exact same group key");
  });

  it("prefers the base umbrella brand name over longer department/alert names", () => {
    assert.strictEqual(chooseBetterSenderName("Patreon", "Patreon Security Alert"), "Patreon");
    assert.strictEqual(chooseBetterSenderName("Patreon Support", "Patreon"), "Patreon");
    assert.strictEqual(chooseBetterSenderName("Uber Receipts", "Uber"), "Uber");
  });

  it("determines optimal filterTerm with boolean OR conditional (' | ') for multiple related emails", () => {
    // Multi-email sender (e.g. Patreon with 12 emails across no-reply and bingo)
    const patreonSender = {
      groupKey: "entity:patreon",
      name: "Patreon",
      email: "no-reply@patreon.com",
      emails: ["no-reply@patreon.com", "bingo@patreon.com"]
    };
    assert.strictEqual(
      getFilterTermForSender(patreonSender),
      "no-reply@patreon.com | bingo@patreon.com",
      "Should join multiple emails with Thunderbird's native boolean OR operator (' | ') so all emails match"
    );

    // Multi-email regional brand sender (e.g. Amazon)
    const amazonSender = {
      groupKey: "entity:amazon",
      name: "Amazon",
      email: "orders@amazon.com",
      emails: ["orders@amazon.com", "shipment@amazon.co.uk"]
    };
    assert.strictEqual(
      getFilterTermForSender(amazonSender),
      "orders@amazon.com | shipment@amazon.co.uk",
      "Should join multiple Amazon emails with OR conditional"
    );

    // Multi-email personal sender across webmail/work
    const personSender = {
      groupKey: "name:jane doe",
      name: "Jane Doe",
      email: "jane@gmail.com",
      emails: ["jane@gmail.com", "jane@work.com"]
    };
    assert.strictEqual(
      getFilterTermForSender(personSender),
      "jane@gmail.com | jane@work.com",
      "Should join personal emails with OR conditional"
    );

    // Deduplication of case-variant or duplicate emails
    const dupesSender = {
      emails: ["test@example.com", "TEST@EXAMPLE.COM", "other@example.com"]
    };
    assert.strictEqual(
      getFilterTermForSender(dupesSender),
      "test@example.com | other@example.com",
      "Should deduplicate case-insensitively and join remaining with OR conditional"
    );

    // Single-email sender
    const singleSender = {
      groupKey: "email:deals@store.com",
      name: "Deals",
      email: "deals@store.com",
      emails: ["deals@store.com"]
    };
    assert.strictEqual(
      getFilterTermForSender(singleSender),
      "deals@store.com",
      "Should filter by exact single email address without pipe"
    );

    // Sender with only name and no emails
    const nameOnlySender = {
      name: "System Notification",
      emails: []
    };
    assert.strictEqual(
      getFilterTermForSender(nameOnlySender),
      "System Notification",
      "Should fallback to name when no emails are present"
    );

    // Invalid/null inputs
    assert.strictEqual(getFilterTermForSender(null), "");
    assert.strictEqual(getFilterTermForSender(undefined), "");
    assert.strictEqual(getFilterTermForSender({}), "");
  });
});
