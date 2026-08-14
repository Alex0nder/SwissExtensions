const test = require("node:test")
const assert = require("node:assert/strict")
const core = require("../command-core.js")

test("normalizes case and accents", () => {
  assert.equal(core.normalize("  Zürich  "), "zurich")
})

test("exact and prefix title matches rank first", () => {
  const ranked = core.rank([
    { id: 1, kind: "tab", title: "Swiss Extensions", url: "https://example.com", host: "example.com" },
    { id: 2, kind: "tab", title: "Extensions Swiss", url: "https://example.org", host: "example.org" },
  ], "swiss", 10)
  assert.equal(ranked[0].id, 1)
})

test("filters unrelated items and preserves source entries", () => {
  const ranked = core.rank([
    { id: 1, kind: "tab", title: "Docs", url: "https://docs.example.com", host: "docs.example.com" },
    { id: 2, kind: "bookmark", title: "Docs", url: "https://docs.example.com", host: "docs.example.com" },
    { id: 3, kind: "history", title: "Mail", url: "https://mail.example.com", host: "mail.example.com" },
  ], "docs", 10)
  assert.deepEqual(ranked.map((item) => item.kind), ["tab", "bookmark"])
})
