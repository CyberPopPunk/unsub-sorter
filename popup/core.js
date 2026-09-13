/**
 * SorterCore - Pure Semantic Logic Engine
 * 
 * Provides deterministic, dependency-free business logic for:
 * - Author parsing and normalization
 * - Date formatting
 * - RFC 2369 List-Unsubscribe header extraction
 * - URL safety validation
 * - Message aggregation and tie-breaking ranking
 * - Egregious offender threshold filtering
 * - Markdown export generation
 * 
 * Exported as UMD for dual usage in browser (Thunderbird MailExtension) and Node.js.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    // Node.js
    module.exports = factory();
  } else {
    // Browser / Thunderbird Window
    root.SorterCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Validate if a string is a safe HTTP or HTTPS URL.
   * Strictly rejects javascript:, data:, file:, etc.
   */
  function isValidHttpUrl(string) {
    if (typeof string !== "string" || !string.trim()) return false;
    try {
      const parsed = new URL(string.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  /**
   * Validate if a string is a valid mailto URI.
   */
  function isValidMailtoUrl(string) {
    if (typeof string !== "string") return false;
    const trimmed = string.trim();
    return trimmed.toLowerCase().startsWith("mailto:") && trimmed.length > 7;
  }

  /**
   * Extract domain name from an email address.
   */
  function getDomainFromEmail(email) {
    if (typeof email !== "string" || !email.includes("@")) return "";
    const parts = email.trim().split("@");
    return parts[parts.length - 1].toLowerCase().trim();
  }

  /**
   * Extract base brand / domain token from a domain name.
   * e.g. "news.nytimes.com" -> "nytimes", "amazon.co.uk" -> "amazon"
   */
  function getBaseDomainName(domain) {
    if (!domain || typeof domain !== "string") return "";
    const parts = domain.toLowerCase().trim().split(".");
    if (parts.length <= 1) return parts[0] || "";
    // Check multi-part TLDs like .co.uk, .com.au, .co.nz, .org.uk
    if (parts.length >= 3 && ["co", "com", "org", "net", "gov", "edu"].includes(parts[parts.length - 2])) {
      return parts[parts.length - 3] || parts[parts.length - 2];
    }
    return parts[parts.length - 2] || parts[0];
  }

  const GENERIC_NAME_TERMS = new Set([
    "support", "noreply", "no-reply", "notifications", "notification",
    "info", "sales", "billing", "service", "services", "news",
    "updates", "update", "marketing", "alert", "alerts", "team",
    "help", "contact", "mail", "hello", "admin", "system",
    "orders", "order", "receipts", "receipt", "account", "accounts",
    "newsletter", "automated", "mailer-daemon", "postmaster",
    "unknown", "unknown sender"
  ]);

  const COMMON_WEBMAIL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com"
  ]);

  const STRIP_SUFFIXES = [
    /\s+(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|gmbh|co\.?)$/i,
    /\s+(team|support|updates?|notifications?|newsletter|alerts?|service|services|customer care|customer service|digest|bulletin|receipts?|orders?|delivery|deals?|promos?|promotions?|offers?)$/i,
    /\.com$/i
  ];

  const STRIP_PREFIXES = [
    /^(the|a|an)\s+/i
  ];

  /**
   * Normalize a display name into a clean canonical string for similarity matching.
   * e.g. "The New York Times" -> "new york times"
   *      "Amazon.com" -> "amazon"
   *      "Uber Receipts" -> "uber"
   *      "Doe, Jane" -> "jane doe"
   */
  function normalizeSenderName(name) {
    if (typeof name !== "string" || !name.trim()) return "";

    let cleaned = name.trim().toLowerCase();

    // If "Last, First", convert to "First Last"
    if (cleaned.includes(",") && !cleaned.includes("inc") && !cleaned.includes("llc")) {
      const parts = cleaned.split(",").map(p => p.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        cleaned = `${parts[1]} ${parts[0]}`;
      }
    }

    // Strip leading prefixes (the, a, an)
    for (const prefix of STRIP_PREFIXES) {
      cleaned = cleaned.replace(prefix, "").trim();
    }

    // Strip trailing suffixes (inc, team, updates, .com, etc.)
    let prev;
    do {
      prev = cleaned;
      for (const suffix of STRIP_SUFFIXES) {
        cleaned = cleaned.replace(suffix, "").trim();
      }
    } while (cleaned !== prev);

    // Remove quotes, brackets, and extra punctuation
    cleaned = cleaned.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();

    return cleaned;
  }

  /**
   * Determine the canonical grouping key for a parsed author.
   * Combines similar names from different email senders into one key.
   */
  function getSenderGroupKey(parsed) {
    if (!parsed || typeof parsed !== "object") return "unknown";

    const email = (parsed.email || "").toLowerCase().trim();
    const domain = getDomainFromEmail(email);
    const domainBase = getBaseDomainName(domain);

    const rawName = (parsed.name || "").trim();
    const normalizedName = normalizeSenderName(rawName);

    // If we have a non-generic display name of 2+ characters
    const isGeneric = !normalizedName || normalizedName.length < 2 || GENERIC_NAME_TERMS.has(normalizedName);
    const isFreeWebmail = !domain || COMMON_WEBMAIL_DOMAINS.has(domain);

    if (!isGeneric) {
      // If the domain base matches the normalized name (e.g. name "Uber", domain "uber.com"),
      // group as brand entity
      if (domainBase && domainBase === normalizedName) {
        return `entity:${normalizedName}`;
      }
      // On free webmail (gmail, yahoo, etc.), don't merge single first names like "Alex" or "John"
      if (isFreeWebmail && !normalizedName.includes(" ")) {
        return `email:${email}`;
      }
      return `name:${normalizedName}`;
    }

    // If name is generic (or email fallback) and not free webmail, group by domain base
    if (domainBase && !isFreeWebmail) {
      return `entity:${domainBase}`;
    }

    // Fallback: Group by specific email
    return `email:${email}`;
  }

  /**
   * Compare two display names and select the cleaner, more representative brand/person name.
   * e.g. "Patreon" vs "Patreon Security Alert" -> prefers "Patreon"
   *      "Uber" vs "Uber Receipts" -> prefers "Uber"
   */
  function chooseBetterSenderName(nameA, nameB) {
    if (!nameA) return nameB || "";
    if (!nameB) return nameA || "";
    if (nameA === nameB) return nameA;

    const cleanA = normalizeSenderName(nameA);
    const cleanB = normalizeSenderName(nameB);

    const aGeneric = GENERIC_NAME_TERMS.has(cleanA) || cleanA.length < 2;
    const bGeneric = GENERIC_NAME_TERMS.has(cleanB) || cleanB.length < 2;
    if (aGeneric && !bGeneric) return nameB;
    if (bGeneric && !aGeneric) return nameA;

    // If both normalize to the same base name, prefer the cleaner/shorter original name
    if (cleanA === cleanB) {
      return nameA.length <= nameB.length ? nameA : nameB;
    }

    // If one is a prefix / umbrella brand of the other, prefer the umbrella brand name
    if (cleanB.startsWith(cleanA) && cleanA.length >= 3) return nameA;
    if (cleanA.startsWith(cleanB) && cleanB.length >= 3) return nameB;

    // Prefer shorter non-generic name if both share prefix, or whichever is cleaner
    return nameA.length <= nameB.length ? nameA : nameB;
  }

  /**
   * Determine the optimal search term for Thunderbird's Quick Filter (Author filter)
   * that matches ALL messages aggregated under this sender card.
   *
   * Thunderbird's Quick Filter engine natively uses the pipe ("|") operator as a boolean OR.
   * When multiple email addresses are aggregated under a card (e.g. "no-reply@patreon.com" and "bingo@patreon.com"),
   * joining them with " | " produces an OR conditional in Thunderbird:
   * (Author contains "no-reply@patreon.com" OR Author contains "bingo@patreon.com").
   */
  function getFilterTermForSender(sender) {
    if (!sender || typeof sender !== "object") return "";

    const rawEmails = Array.isArray(sender.emails) && sender.emails.length > 0
      ? sender.emails
      : (sender.email ? [sender.email] : []);

    // Clean, normalize and deduplicate email addresses
    const uniqueEmails = Array.from(
      new Set(
        rawEmails
          .map(e => (typeof e === "string" ? e.trim().toLowerCase() : ""))
          .filter(Boolean)
      )
    );

    // 1. Multiple email addresses: join with Thunderbird's native boolean OR operator (" | ")
    if (uniqueEmails.length > 1) {
      return uniqueEmails.join(" | ");
    }

    // 2. Single email address: filter by that exact email
    if (uniqueEmails.length === 1) {
      return uniqueEmails[0];
    }

    // 3. Fallback to sender name or email property if available
    return sender.name || sender.email || "";
  }


  /**
   * Parse an author header into display name, normalized email, and raw representation.
   * Handles:
   * - "John Doe" <john@example.com>
   * - 'Doe, Jane' <jane@example.com>
   * - John Doe <john@example.com>
   * - <john@example.com>
   * - john@example.com
   * - Case normalization (e.g. USER@DOMAIN.COM -> user@domain.com)
   */
  function parseAuthor(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
      return { name: "Unknown Sender", email: "unknown@unknown.com", raw: "", hasExplicitName: false };
    }

    const trimmed = raw.trim();

    // Match "Name" <email> or Name <email> (including quoted names with commas)
    const angleMatch = trimmed.match(/^(?:["']?([^"']*)["']?\s*)?<([^>]+)>$/);
    if (angleMatch) {
      let name = (angleMatch[1] || "").trim();
      const email = angleMatch[2].trim().toLowerCase();
      const hasExplicitName = Boolean(name);
      if (!name) {
        name = email.includes("@") ? email.split("@")[0] : email;
      }
      return { name, email, raw: trimmed, hasExplicitName };
    }

    // Match plain email address without brackets
    const emailMatch = trimmed.match(/^([^\s@]+@[^\s@]+\.[^\s@]+)$/);
    if (emailMatch) {
      const email = emailMatch[1].toLowerCase().trim();
      return { name: email.split("@")[0], email, raw: trimmed, hasExplicitName: false };
    }

    // Fallback: If it contains an @, try to find email substring
    const fallbackMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (fallbackMatch) {
      const email = fallbackMatch[1].toLowerCase().trim();
      const namePart = trimmed.replace(fallbackMatch[0], "").replace(/[<>"']/g, "").trim();
      return {
        name: namePart || email.split("@")[0],
        email,
        raw: trimmed,
        hasExplicitName: Boolean(namePart)
      };
    }

    // Bare string fallback
    return { name: trimmed, email: trimmed.toLowerCase(), raw: trimmed, hasExplicitName: false };
  }

  /**
   * Format a date into relative time (for today) or short date (for earlier dates).
   * referenceNow allows deterministic testing.
   */
  function formatDate(date, referenceNow = new Date()) {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";

    const now = referenceNow instanceof Date ? referenceNow : new Date(referenceNow);
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);

    if (isSameDay && diffHours >= 0 && diffHours < 24) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  /**
   * Parse RFC 2369 List-Unsubscribe Header.
   * Extracts valid HTTP/HTTPS URLs and mailto URIs.
   * Strictly filters out any dangerous or non-web protocols.
   */
  function parseUnsubscribeHeader(headers) {
    if (!headers || typeof headers !== "object") return null;

    let raw = headers["list-unsubscribe"] || headers["List-Unsubscribe"];
    if (!raw) return null;
    if (Array.isArray(raw)) raw = raw.join(", ");
    if (typeof raw !== "string") return null;

    let httpUrl = null;
    let mailtoUrl = null;

    // Standard format: <https://...>, <mailto:...>
    const angleMatches = raw.match(/<([^>]+)>/g);
    if (angleMatches) {
      for (const match of angleMatches) {
        const url = match.slice(1, -1).trim();
        if (isValidHttpUrl(url) && !httpUrl) {
          httpUrl = url;
        } else if (isValidMailtoUrl(url) && !mailtoUrl) {
          mailtoUrl = url;
        }
      }
    } else {
      // Fallback: Space or comma separated tokens
      const parts = raw.split(/[\s,]+/);
      for (const p of parts) {
        if (isValidHttpUrl(p) && !httpUrl) {
          httpUrl = p;
        } else if (isValidMailtoUrl(p) && !mailtoUrl) {
          mailtoUrl = p;
        }
      }
    }

    if (!httpUrl && !mailtoUrl) return null;
    return { httpUrl, mailtoUrl, raw };
  }

  /**
   * Aggregate a list of raw Thunderbird messages into grouped senders,
   * ranked descending by unreadCount, with latestDate as tie-breaker.
   * Combines similar names from different email senders into one card.
   * 
   * @param {Array} messages List of message headers ({ id, author, date, subject })
   * @returns {Array} Ranked list of sender objects
   */
  function groupAndRankSenders(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    // Phase 1: Group raw messages by normalized email address
    const emailSenders = new Map();

    for (const msg of messages) {
      if (!msg) continue;
      const parsed = parseAuthor(msg.author);
      const email = parsed.email;

      if (!emailSenders.has(email)) {
        emailSenders.set(email, {
          email,
          bestName: parsed.name,
          hasExplicitName: parsed.hasExplicitName,
          messages: []
        });
      }

      const senderEntry = emailSenders.get(email);
      senderEntry.messages.push({ msg, parsed });

      // If we see an explicit display name, prefer it
      if (parsed.hasExplicitName) {
        if (!senderEntry.hasExplicitName) {
          senderEntry.bestName = parsed.name;
          senderEntry.hasExplicitName = true;
        } else {
          senderEntry.bestName = chooseBetterSenderName(senderEntry.bestName, parsed.name);
        }
      } else if (!senderEntry.hasExplicitName && parsed.name && parsed.name !== email) {
        senderEntry.bestName = parsed.name;
      }
    }

    // Phase 2: Combine similar names from different email senders into group cards
    const groupsMap = new Map();

    for (const [email, senderEntry] of emailSenders.entries()) {
      const canonicalParsed = {
        name: senderEntry.bestName,
        email: email
      };
      const groupKey = getSenderGroupKey(canonicalParsed);

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          groupKey,
          email: email,
          emails: [],
          name: senderEntry.bestName,
          hasExplicitName: senderEntry.hasExplicitName,
          rawAuthor: "",
          unreadCount: 0,
          messageIds: [],
          latestDate: new Date(0),
          latestSubject: "(No subject)",
          latestMessageId: null
        });
      }

      const group = groupsMap.get(groupKey);
      if (!group.emails.includes(email)) {
        group.emails.push(email);
      }

      // Choose best representative sender/brand name across the group
      if (senderEntry.hasExplicitName) {
        if (!group.hasExplicitName) {
          group.name = senderEntry.bestName;
          group.hasExplicitName = true;
        } else {
          group.name = chooseBetterSenderName(group.name, senderEntry.bestName);
        }
      }

      for (const { msg, parsed } of senderEntry.messages) {
        group.unreadCount++;
        const msgId = msg.id || null;
        if (msgId && !group.messageIds.includes(msgId)) {
          group.messageIds.push(msgId);
        }

        const msgDate = msg.date ? new Date(msg.date) : new Date(0);
        const msgSubject = msg.subject || "(No subject)";

        if (msgDate >= group.latestDate) {
          group.latestDate = msgDate;
          group.latestSubject = msgSubject;
          if (msgId) group.latestMessageId = msgId;
          group.email = email;
          group.rawAuthor = parsed.raw || "";
        }
      }
    }

    // Rank descending by unread count, then latest date
    return Array.from(groupsMap.values()).sort((a, b) => {
      if (b.unreadCount !== a.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      return b.latestDate.getTime() - a.latestDate.getTime();
    });
  }

  /**
   * Filter ranked senders to obtain egregious offenders based on threshold.
   * 
   * @param {Array} rankedSenders List of ranked senders
   * @param {number|string} threshold Minimum count (e.g. 3, 5, 10) or "top10"
   * @returns {Array} Filtered list of offenders
   */
  function filterEgregiousOffenders(rankedSenders, threshold = 3) {
    if (!Array.isArray(rankedSenders)) return [];

    if (threshold === "top10") {
      return rankedSenders.slice(0, 10);
    }

    const minCount = typeof threshold === "number" ? threshold : parseInt(threshold, 10) || 3;
    return rankedSenders.filter(s => s && s.unreadCount >= minCount);
  }

  /**
   * Format the list of egregious offenders into a clean Markdown table for clipboard export.
   * Safely escapes markdown table characters (like pipes).
   */
  function formatUnsubscribeListMarkdown(options = {}) {
    const {
      offenders = [],
      folderName = "Inbox",
      threshold = 3,
      unsubscribedSet = new Set(),
      unsubInfoMap = new Map(),
      referenceDate = new Date()
    } = options;

    if (!Array.isArray(offenders) || offenders.length === 0) {
      return "";
    }

    const thresholdLabel = threshold === "top10" ? "Top 10" : `≥ ${threshold} unread`;
    const dateStr = referenceDate instanceof Date ? referenceDate.toLocaleDateString() : new Date().toLocaleDateString();

    const rows = [];
    rows.push("# Egregious Offenders & Unsubscribe List");
    rows.push(`Folder: ${folderName.replace(/\|/g, "/")} | Threshold: ${thresholdLabel}`);
    rows.push(`Total Offenders: ${offenders.length} | Date: ${dateStr}\n`);
    rows.push("| Rank | Sender | Email | Unread | Status | Unsubscribe Link / Method |");
    rows.push("|:---:|:---|:---|:---:|:---:|:---|");

    for (let i = 0; i < offenders.length; i++) {
      const s = offenders[i];
      const isUnsub = unsubscribedSet.has(s.email);
      const statusText = isUnsub ? "✅ Unsubscribed" : "⏳ Pending";

      const unsub = unsubInfoMap.get(s.email);
      let unsubMethod = "Check email body footer";
      if (unsub && unsub.httpUrl) {
        unsubMethod = `[1-Click Unsubscribe Link](${unsub.httpUrl})`;
      } else if (unsub && unsub.mailtoUrl) {
        unsubMethod = `Mailto: ${unsub.mailtoUrl}`;
      }

      const safeName = (s.name || "Unknown").replace(/\|/g, "-").trim();
      const safeEmail = (s.emails && s.emails.length > 1 ? s.emails.join(", ") : s.email || "").replace(/\|/g, "");

      rows.push(`| #${i + 1} | ${safeName} | \`${safeEmail}\` | **${s.unreadCount}** | ${statusText} | ${unsubMethod} |`);
    }

    return rows.join("\n");
  }

  return {
    isValidHttpUrl,
    isValidMailtoUrl,
    getDomainFromEmail,
    getBaseDomainName,
    normalizeSenderName,
    getSenderGroupKey,
    chooseBetterSenderName,
    getFilterTermForSender,
    parseAuthor,
    formatDate,
    parseUnsubscribeHeader,
    groupAndRankSenders,
    filterEgregiousOffenders,
    formatUnsubscribeListMarkdown
  };
});
