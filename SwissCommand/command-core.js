(function (root, factory) {
  const api = factory()
  root.SwissCommandCore = api
  if (typeof module === "object" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict"

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim()
  }

  function sourceRank(kind) {
    if (kind === "tab") return 30
    if (kind === "bookmark") return 20
    return 10
  }

  function score(item, query) {
    const q = normalize(query)
    const title = normalize(item.title)
    const url = normalize(item.url)
    const host = normalize(item.host)
    const haystack = `${title} ${host} ${url}`
    const recency = Number(item.recency || 0)

    if (!q) return sourceRank(item.kind) + Math.min(15, recency)
    if (!haystack.includes(q) && !q.split(/\s+/).every((token) => haystack.includes(token))) {
      return -1
    }

    let value = sourceRank(item.kind)
    if (title === q) value += 120
    else if (title.startsWith(q)) value += 90
    else if (title.includes(q)) value += 65
    if (host === q) value += 80
    else if (host.startsWith(q)) value += 50
    else if (url.includes(q)) value += 25
    value += q.split(/\s+/).filter((token) => title.includes(token)).length * 8
    return value + Math.min(15, recency)
  }

  function rank(items, query, limit) {
    const seen = new Set()
    return items
      .map((item) => ({ ...item, score: score(item, query) }))
      .filter((item) => item.score >= 0 && item.url)
      .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
      .filter((item) => {
        const key = item.kind === "tab" ? `tab:${item.id}` : `${item.kind}:${item.url}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit || 40)
  }

  return { normalize, rank, score }
})
