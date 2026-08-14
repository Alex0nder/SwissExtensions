export type CommandResult = {
  id: number | string
  kind: "tab" | "bookmark" | "history"
  title: string
  url: string
  host: string
  windowId?: number
  score: number
}

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function rankValue(
  item: Omit<CommandResult, "score"> & { recency?: number },
  query: string
) {
  const q = normalize(query)
  const title = normalize(item.title)
  const host = normalize(item.host)
  const url = normalize(item.url)
  const haystack = `${title} ${host} ${url}`
  const source = item.kind === "tab" ? 30 : item.kind === "bookmark" ? 20 : 10
  if (!q) return source + Math.min(15, item.recency || 0)
  if (!haystack.includes(q) && !q.split(/\s+/).every((token) => haystack.includes(token))) return -1
  let score = source
  if (title === q) score += 120
  else if (title.startsWith(q)) score += 90
  else if (title.includes(q)) score += 65
  if (host === q) score += 80
  else if (host.startsWith(q)) score += 50
  else if (url.includes(q)) score += 25
  return score + Math.min(15, item.recency || 0)
}

export async function searchBrowser(query: string, limit = 40) {
  const [tabs, bookmarks, history] = await Promise.all([
    chrome.tabs.query({}),
    query ? chrome.bookmarks.search(query) : chrome.bookmarks.getRecent(24),
    chrome.history.search({ text: query, startTime: 0, maxResults: 40 }),
  ])
  const now = Date.now()
  const items: Array<Omit<CommandResult, "score"> & { recency?: number }> = [
    ...tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => Boolean(tab.id && tab.url))
      .map((tab, index) => ({
        id: tab.id,
        windowId: tab.windowId,
        kind: "tab" as const,
        title: tab.title || hostOf(tab.url),
        url: tab.url,
        host: hostOf(tab.url),
        recency: tab.active ? 15 : Math.max(0, 10 - index),
      })),
    ...bookmarks
      .filter((item): item is chrome.bookmarks.BookmarkTreeNode & { url: string } => Boolean(item.url))
      .map((item) => ({
        id: item.id,
        kind: "bookmark" as const,
        title: item.title || hostOf(item.url),
        url: item.url,
        host: hostOf(item.url),
        recency: item.dateAdded ? Math.max(0, 10 - (now - item.dateAdded) / 86_400_000) : 0,
      })),
    ...history
      .filter((item): item is chrome.history.HistoryItem & { id: string; url: string } => Boolean(item.id && item.url))
      .map((item) => ({
        id: item.id,
        kind: "history" as const,
        title: item.title || hostOf(item.url),
        url: item.url,
        host: hostOf(item.url),
        recency: item.lastVisitTime ? Math.max(0, 12 - (now - item.lastVisitTime) / 86_400_000) : 0,
      })),
  ]
  const seen = new Set<string>()
  return items
    .map((item) => ({ ...item, score: rankValue(item, query) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .filter((item) => {
      const key = item.kind === "tab" ? `tab:${item.id}` : `${item.kind}:${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit) as CommandResult[]
}

export async function openCommandResult(result: CommandResult) {
  if (result.kind === "tab" && typeof result.id === "number") {
    await chrome.tabs.update(result.id, { active: true })
    if (typeof result.windowId === "number") await chrome.windows.update(result.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url: result.url })
}

export function commandFaviconUrl(url: string) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`)
}
