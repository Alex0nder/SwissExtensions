(function () {
  "use strict"

  const input = document.getElementById("command-search")
  const list = document.getElementById("command-results")
  const status = document.getElementById("result-status")
  const clear = document.getElementById("clear-search")
  let results = []
  let selected = 0
  let searchToken = 0
  let timer = 0

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, "") }
    catch { return url || "" }
  }

  function faviconUrl(url) {
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`)
  }

  function svgIcon(kind) {
    if (kind === "bookmark") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10v15l-5-3-5 3z"/></svg>'
    if (kind === "history") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 8.9"/><path d="M4.5 4.8v4.1h4.1M12 8v4.5l3 1.8"/></svg>'
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="13" rx="2"/><path d="M8 21h8"/></svg>'
  }

  async function collect(query) {
    const [tabs, bookmarks, history] = await Promise.all([
      chrome.tabs.query({}),
      query ? chrome.bookmarks.search(query) : chrome.bookmarks.getRecent(24),
      chrome.history.search({ text: query, startTime: 0, maxResults: 40 }),
    ])
    const now = Date.now()
    return [
      ...tabs.filter((tab) => tab.url).map((tab, index) => ({
        id: tab.id, windowId: tab.windowId, kind: "tab", title: tab.title || hostOf(tab.url),
        url: tab.url, host: hostOf(tab.url), recency: tab.active ? 15 : Math.max(0, 10 - index),
      })),
      ...bookmarks.filter((item) => item.url).map((item) => ({
        id: item.id, kind: "bookmark", title: item.title || hostOf(item.url), url: item.url,
        host: hostOf(item.url), recency: item.dateAdded ? Math.max(0, 10 - (now - item.dateAdded) / 86400000) : 0,
      })),
      ...history.filter((item) => item.url).map((item) => ({
        id: item.id, kind: "history", title: item.title || hostOf(item.url), url: item.url,
        host: hostOf(item.url), recency: item.lastVisitTime ? Math.max(0, 12 - (now - item.lastVisitTime) / 86400000) : 0,
      })),
    ]
  }

  function render() {
    list.textContent = ""
    input.setAttribute("aria-activedescendant", results[selected] ? `command-result-${selected}` : "")
    status.textContent = results.length ? `${results.length} results` : ""
    if (!results.length) {
      const empty = document.createElement("li")
      empty.className = "empty-state"
      empty.textContent = input.value.trim() ? "No matching tabs, bookmarks, or history." : "Your browser activity will appear here."
      list.append(empty)
      return
    }
    results.forEach((item, index) => {
      const option = document.createElement("li")
      option.id = `command-result-${index}`
      option.className = "result-item"
      option.setAttribute("role", "option")
      option.setAttribute("aria-selected", String(index === selected))
      option.dataset.index = String(index)
      const icon = document.createElement("span")
      icon.className = "result-icon"
      icon.innerHTML = svgIcon(item.kind)
      if (item.kind === "tab") {
        const img = document.createElement("img")
        img.src = faviconUrl(item.url)
        img.alt = ""
        img.addEventListener("error", () => { img.hidden = true })
        icon.innerHTML = svgIcon("tab")
        icon.append(img)
      }
      const copy = document.createElement("span")
      copy.className = "result-copy"
      const title = document.createElement("span")
      title.className = "result-title"
      title.textContent = item.title || item.host
      const url = document.createElement("span")
      url.className = "result-url"
      url.textContent = item.host || item.url
      copy.append(title, url)
      const kind = document.createElement("span")
      kind.className = "result-kind"
      kind.textContent = item.kind
      option.append(icon, copy, kind)
      option.addEventListener("mouseenter", () => { if (selected !== index) { selected = index; render() } })
      option.addEventListener("click", () => void openResult(item))
      list.append(option)
    })
    document.getElementById(`command-result-${selected}`)?.scrollIntoView({ block: "nearest" })
  }

  async function runSearch() {
    const token = ++searchToken
    const query = input.value.trim()
    clear.hidden = !query
    try {
      const items = await collect(query)
      if (token !== searchToken) return
      results = SwissCommandCore.rank(items, query, 40)
      selected = 0
      render()
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    }
  }

  async function openResult(item) {
    if (item.kind === "tab" && Number.isInteger(item.id)) {
      await chrome.tabs.update(item.id, { active: true })
      if (Number.isInteger(item.windowId)) await chrome.windows.update(item.windowId, { focused: true })
    } else {
      await chrome.tabs.create({ url: item.url })
    }
    window.close()
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void runSearch(), 90)
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); selected = Math.min(results.length - 1, selected + 1); render() }
    else if (event.key === "ArrowUp") { event.preventDefault(); selected = Math.max(0, selected - 1); render() }
    else if (event.key === "Enter" && results[selected]) { event.preventDefault(); void openResult(results[selected]) }
    else if (event.key === "Escape") { event.preventDefault(); if (input.value) { input.value = ""; void runSearch() } else window.close() }
  })
  clear.addEventListener("click", () => { input.value = ""; input.focus(); void runSearch() })

  input.focus()
  void runSearch()
})()
