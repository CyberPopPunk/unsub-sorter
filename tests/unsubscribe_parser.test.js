const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  isValidHttpUrl,
  isValidMailtoUrl,
  parseUnsubscribeHeader,
  getDomainFromEmail
} = require("../popup/core.js");

describe("Semantic Logic: URL & Header Validation", () => {
  describe("isValidHttpUrl()", () => {
    it("accepts valid https and http URLs", () => {
      assert.strictEqual(isValidHttpUrl("https://example.com/unsubscribe?id=123"), true);
      assert.strictEqual(isValidHttpUrl("http://sub.domain.org/opt-out"), true);
    });

    it("rejects dangerous or non-web protocols", () => {
      assert.strictEqual(isValidHttpUrl("javascript:alert(document.cookie)"), false);
      assert.strictEqual(isValidHttpUrl("data:text/html,<script>alert(1)</script>"), false);
      assert.strictEqual(isValidHttpUrl("file:///C:/Windows/System32/calc.exe"), false);
      assert.strictEqual(isValidHttpUrl("vbscript:MsgBox(1)"), false);
    });

    it("rejects invalid strings, relative paths, and non-strings", () => {
      assert.strictEqual(isValidHttpUrl("/relative/path"), false);
      assert.strictEqual(isValidHttpUrl("not a url"), false);
      assert.strictEqual(isValidHttpUrl(""), false);
      assert.strictEqual(isValidHttpUrl(null), false);
      assert.strictEqual(isValidHttpUrl(undefined), false);
    });
  });

  describe("isValidMailtoUrl()", () => {
    it("accepts valid mailto addresses", () => {
      assert.strictEqual(isValidMailtoUrl("mailto:unsubscribe@example.com"), true);
      assert.strictEqual(isValidMailtoUrl("mailto:optout@store.com?subject=remove"), true);
    });

    it("rejects non-mailto strings", () => {
      assert.strictEqual(isValidMailtoUrl("https://example.com"), false);
      assert.strictEqual(isValidMailtoUrl("mailto:"), false);
      assert.strictEqual(isValidMailtoUrl(""), false);
      assert.strictEqual(isValidMailtoUrl(null), false);
    });
  });

  describe("getDomainFromEmail()", () => {
    it("extracts clean lower-case domain from email", () => {
      assert.strictEqual(getDomainFromEmail("john@example.com"), "example.com");
      assert.strictEqual(getDomainFromEmail("ALERT@NEWS.SUB.CORP.ORG"), "news.sub.corp.org");
    });

    it("handles invalid email input gracefully", () => {
      assert.strictEqual(getDomainFromEmail("not-an-email"), "");
      assert.strictEqual(getDomainFromEmail(null), "");
      assert.strictEqual(getDomainFromEmail(""), "");
    });
  });

  describe("parseUnsubscribeHeader()", () => {
    it("parses single https URL in angle brackets", () => {
      const headers = { "list-unsubscribe": ["<https://news.example.com/unsub?user=999>"] };
      const result = parseUnsubscribeHeader(headers);
      assert.ok(result);
      assert.strictEqual(result.httpUrl, "https://news.example.com/unsub?user=999");
      assert.strictEqual(result.mailtoUrl, null);
    });

    it("parses combined web URL and mailto URI", () => {
      const headers = {
        "list-unsubscribe": [
          "<https://promo.store.com/unsub>, <mailto:unsub@store.com?subject=unsubscribe>"
        ]
      };
      const result = parseUnsubscribeHeader(headers);
      assert.ok(result);
      assert.strictEqual(result.httpUrl, "https://promo.store.com/unsub");
      assert.strictEqual(result.mailtoUrl, "mailto:unsub@store.com?subject=unsubscribe");
    });

    it("handles header provided as a plain string instead of array", () => {
      const headers = {
        "List-Unsubscribe": "<https://service.net/opt-out>"
      };
      const result = parseUnsubscribeHeader(headers);
      assert.ok(result);
      assert.strictEqual(result.httpUrl, "https://service.net/opt-out");
    });

    it("strictly ignores javascript: or dangerous injection URLs", () => {
      const headers = {
        "list-unsubscribe": ["<javascript:alert('pwn')>, <https://legit.com/unsub>"]
      };
      const result = parseUnsubscribeHeader(headers);
      assert.ok(result);
      // javascript: should be ignored, and the legitimate https link picked up
      assert.strictEqual(result.httpUrl, "https://legit.com/unsub");
    });

    it("returns null if only malicious links exist", () => {
      const headers = {
        "list-unsubscribe": ["<javascript:alert(1)>, <data:text/plain,foo>"]
      };
      const result = parseUnsubscribeHeader(headers);
      assert.strictEqual(result, null);
    });

    it("returns null when list-unsubscribe header is absent or empty", () => {
      assert.strictEqual(parseUnsubscribeHeader({}), null);
      assert.strictEqual(parseUnsubscribeHeader(null), null);
      assert.strictEqual(parseUnsubscribeHeader({ "list-unsubscribe": [] }), null);
      assert.strictEqual(parseUnsubscribeHeader({ "subject": ["Test"] }), null);
    });
  });
});
