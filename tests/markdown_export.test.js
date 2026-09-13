const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatUnsubscribeListMarkdown } = require("../popup/core.js");

describe("Semantic Logic: formatUnsubscribeListMarkdown()", () => {
  const mockOffenders = [
    { name: "Promo Deals", email: "promo@store.com", unreadCount: 42 },
    { name: "Daily | Digest", email: "digest@news.com", unreadCount: 25 },
    { name: "Old Newsletter", email: "old@spam.net", unreadCount: 7 }
  ];

  const mockUnsubInfo = new Map([
    ["promo@store.com", { httpUrl: "https://store.com/opt-out", mailtoUrl: null }],
    ["digest@news.com", { httpUrl: null, mailtoUrl: "mailto:remove@news.com" }],
    ["old@spam.net", null]
  ]);

  const mockUnsubscribedSet = new Set(["old@spam.net"]);

  it("generates structured markdown table with correct columns and headers", () => {
    const md = formatUnsubscribeListMarkdown({
      offenders: mockOffenders,
      folderName: "Inbox",
      threshold: 5,
      unsubscribedSet: mockUnsubscribedSet,
      unsubInfoMap: mockUnsubInfo,
      referenceDate: new Date("2026-09-13T12:00:00Z")
    });

    assert.ok(md.includes("# Egregious Offenders & Unsubscribe List"));
    assert.ok(md.includes("Folder: Inbox | Threshold: ≥ 5 unread"));
    assert.ok(md.includes("Total Offenders: 3"));
    assert.ok(md.includes("| Rank | Sender | Email | Unread | Status | Unsubscribe Link / Method |"));
  });

  it("safely escapes pipe characters in sender names", () => {
    const md = formatUnsubscribeListMarkdown({
      offenders: mockOffenders,
      unsubscribedSet: mockUnsubscribedSet,
      unsubInfoMap: mockUnsubInfo
    });

    // "Daily | Digest" should be escaped to "Daily - Digest"
    assert.ok(md.includes("Daily - Digest"));
    assert.ok(!md.includes("Daily | Digest"));
  });

  it("formats 1-click web links, mailto links, and fallback footer directions", () => {
    const md = formatUnsubscribeListMarkdown({
      offenders: mockOffenders,
      unsubscribedSet: mockUnsubscribedSet,
      unsubInfoMap: mockUnsubInfo
    });

    // 1-Click web link
    assert.ok(md.includes("[1-Click Unsubscribe Link](https://store.com/opt-out)"));
    // Mailto link
    assert.ok(md.includes("Mailto: mailto:remove@news.com"));
    // Fallback
    assert.ok(md.includes("Check email body footer"));
  });

  it("accurately represents completed vs pending unsubscribed statuses", () => {
    const md = formatUnsubscribeListMarkdown({
      offenders: mockOffenders,
      unsubscribedSet: mockUnsubscribedSet,
      unsubInfoMap: mockUnsubInfo
    });

    // promo is pending
    assert.ok(md.includes("`promo@store.com` | **42** | ⏳ Pending"));
    // old newsletter is unsubscribed
    assert.ok(md.includes("`old@spam.net` | **7** | ✅ Unsubscribed"));
  });

  it("returns empty string when offenders array is empty", () => {
    assert.strictEqual(formatUnsubscribeListMarkdown({ offenders: [] }), "");
    assert.strictEqual(formatUnsubscribeListMarkdown({}), "");
  });
});
