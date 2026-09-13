const { describe, it } = require("node:test");
const assert = require("node:assert");
const { filterEgregiousOffenders } = require("../popup/core.js");

describe("Semantic Logic: filterEgregiousOffenders()", () => {
  // Mock dataset with 15 senders having unread counts 15 down to 1
  const mockSenders = Array.from({ length: 15 }, (_, i) => ({
    email: `sender${i + 1}@domain.com`,
    name: `Sender ${i + 1}`,
    unreadCount: 15 - i
  }));

  it("filters senders with threshold >= 3", () => {
    const result = filterEgregiousOffenders(mockSenders, 3);
    // unread counts 15 down to 3 = 13 senders
    assert.strictEqual(result.length, 13);
    assert.ok(result.every(s => s.unreadCount >= 3));
  });

  it("filters senders with threshold >= 5", () => {
    const result = filterEgregiousOffenders(mockSenders, 5);
    // unread counts 15 down to 5 = 11 senders
    assert.strictEqual(result.length, 11);
    assert.ok(result.every(s => s.unreadCount >= 5));
  });

  it("filters senders with threshold >= 10", () => {
    const result = filterEgregiousOffenders(mockSenders, 10);
    // unread counts 15 down to 10 = 6 senders
    assert.strictEqual(result.length, 6);
    assert.ok(result.every(s => s.unreadCount >= 10));
  });

  it("extracts exact top 10 senders when threshold is 'top10'", () => {
    const result = filterEgregiousOffenders(mockSenders, "top10");
    assert.strictEqual(result.length, 10);
    assert.strictEqual(result[0].unreadCount, 15);
    assert.strictEqual(result[9].unreadCount, 6);
  });

  it("handles 'top10' when total senders is less than 10", () => {
    const smallList = mockSenders.slice(0, 4);
    const result = filterEgregiousOffenders(smallList, "top10");
    assert.strictEqual(result.length, 4);
  });

  it("handles empty or invalid inputs", () => {
    assert.deepStrictEqual(filterEgregiousOffenders([], 3), []);
    assert.deepStrictEqual(filterEgregiousOffenders(null, 3), []);
    assert.deepStrictEqual(filterEgregiousOffenders(undefined, 3), []);
  });
});
