const { describe, it } = require("node:test");
const assert = require("node:assert");
const { parseAuthor } = require("../popup/core.js");

describe("Semantic Logic: parseAuthor()", () => {
  it("parses standard quoted name with brackets", () => {
    const result = parseAuthor('"John Doe" <john.doe@example.com>');
    assert.strictEqual(result.name, "John Doe");
    assert.strictEqual(result.email, "john.doe@example.com");
    assert.strictEqual(result.raw, '"John Doe" <john.doe@example.com>');
  });

  it("parses unquoted display name with brackets", () => {
    const result = parseAuthor("Alice Wonderland <alice@example.com>");
    assert.strictEqual(result.name, "Alice Wonderland");
    assert.strictEqual(result.email, "alice@example.com");
  });

  it("parses quoted names with commas (e.g. 'Last, First')", () => {
    const result = parseAuthor('"Smith, Dr. Robert" <robert.smith@clinic.org>');
    assert.strictEqual(result.name, "Smith, Dr. Robert");
    assert.strictEqual(result.email, "robert.smith@clinic.org");
  });

  it("parses single-quoted display names", () => {
    const result = parseAuthor("'Newsletter Team' <news@daily.com>");
    assert.strictEqual(result.name, "Newsletter Team");
    assert.strictEqual(result.email, "news@daily.com");
  });

  it("normalizes uppercase email addresses to lowercase", () => {
    const result = parseAuthor("Marketing <DEALS@STORE.COM>");
    assert.strictEqual(result.name, "Marketing");
    assert.strictEqual(result.email, "deals@store.com");
  });

  it("handles angle-bracketed email with no display name", () => {
    const result = parseAuthor("<support@company.org>");
    assert.strictEqual(result.name, "support");
    assert.strictEqual(result.email, "support@company.org");
  });

  it("handles plain email string without brackets", () => {
    const result = parseAuthor("billing@service.net");
    assert.strictEqual(result.name, "billing");
    assert.strictEqual(result.email, "billing@service.net");
  });

  it("gracefully handles null, undefined, or non-string inputs", () => {
    assert.strictEqual(parseAuthor(null).email, "unknown@unknown.com");
    assert.strictEqual(parseAuthor(undefined).email, "unknown@unknown.com");
    assert.strictEqual(parseAuthor("").email, "unknown@unknown.com");
    assert.strictEqual(parseAuthor("   ").email, "unknown@unknown.com");
  });

  it("handles trailing and leading whitespace cleanly", () => {
    const result = parseAuthor("   FedEx Updates <delivery@fedex.com>   ");
    assert.strictEqual(result.name, "FedEx Updates");
    assert.strictEqual(result.email, "delivery@fedex.com");
  });

  it("handles embedded email in irregular text string", () => {
    const result = parseAuthor("Order Notification system@store.com automated");
    assert.strictEqual(result.email, "system@store.com");
    assert.ok(result.name.length > 0);
  });
});
