import { useEffect, useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import { getLocal, sendMessage, setLocal } from "@/lib/chrome"
import { useUiTheme } from "@/lib/use-ui-theme"

type ItemSource = "closed" | "blocker" | "archive"
type Item = {
  url: string
  title?: string
  source?: ItemSource
  groupKey?: string
  groupTitle?: string
  groupColor?: `${chrome.tabGroups.Color}`
  groupCollapsed?: boolean
  tabIndexInGroup?: number
}

type StoredHistory = {
  closedAndSaved?: Item[]
  blockedTabsSaved?: Item[]
  orphanedSuspendedArchive?: Item[]
}

type DailySnapshot = {
  key: string
  date: string
  savedAt?: number
  count?: number
  groupCount?: number
  reason?: string
}

function urlKey(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    if (parsed.protocol === "file:") return `file:${parsed.pathname}`
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase()
    const path =
      parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname
    return `${host}${path}${parsed.search}`
  } catch {
    return url.trim()
  }
}

export function HistoryApp() {
  useUiTheme()
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [status, setStatus] = useState("")
  const [opening, setOpening] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([])
  const [selectedSnapshotKey, setSelectedSnapshotKey] = useState("")

  const load = async () => {
    const raw = await getLocal<StoredHistory>([
      "closedAndSaved",
      "blockedTabsSaved",
      "orphanedSuspendedArchive",
    ])
    const merged: Item[] = []
    const seen = new Set<string>()
    const push = (list: Item[] | undefined, source: ItemSource) => {
      for (const it of list || []) {
        const key = it?.url ? urlKey(it.url) : ""
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push({ ...it, source })
      }
    }
    push(raw.closedAndSaved, "closed")
    push(raw.blockedTabsSaved, "blocker")
    push(raw.orphanedSuspendedArchive, "archive")
    setItems(merged)
    const recovery = await sendMessage<{
      snapshots?: DailySnapshot[]
    }>({ type: "getDailySessionSnapshots" }).catch(() => ({ snapshots: [] }))
    const nextSnapshots = recovery.snapshots || []
    setSnapshots(nextSnapshots)
    setSelectedSnapshotKey((current) =>
      nextSnapshots.some((snapshot) => snapshot.key === current)
        ? current
        : nextSnapshots[0]?.key || ""
    )
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") return
      const progress = changes.historyOpenProgress?.newValue as
        | { processed?: number; opened?: number; failed?: number; total?: number }
        | undefined
      if (!progress) return
      setStatus(
        `Opening ${progress.processed || 0}/${progress.total || 0} · opened ${progress.opened || 0}${progress.failed ? ` · failed ${progress.failed}` : ""}`
      )
    }
    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => {
      window.clearTimeout(timer)
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.url.toLowerCase().includes(q) ||
        (i.title || "").toLowerCase().includes(q)
    )
  }, [items, filter])

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const removeItemsFromLocalHistory = async (toRemove: Item[]) => {
    const removeKeys = new Set(toRemove.map((item) => urlKey(item.url)))
    const raw = await getLocal<StoredHistory>([
      "closedAndSaved",
      "blockedTabsSaved",
      "orphanedSuspendedArchive",
    ])
    let removed = 0
    const withoutRemoved = (list: Item[] | undefined) => {
      const current = list || []
      const next = current.filter((item) => !removeKeys.has(urlKey(item.url)))
      removed += current.length - next.length
      return next
    }
    await setLocal({
      closedAndSaved: withoutRemoved(raw.closedAndSaved),
      blockedTabsSaved: withoutRemoved(raw.blockedTabsSaved),
      orphanedSuspendedArchive: withoutRemoved(raw.orphanedSuspendedArchive),
    })
    return removed
  }

  const openItems = async (toOpen: Item[]) => {
    if (!toOpen.length) {
      setStatus("No URLs to open")
      return
    }
    setOpening(true)
    setStatus("Opening…")
    try {
      const res = await sendMessage<{
        error?: string
        opened?: number
        failed?: number
        openedItems?: Item[]
      }>({
        type: "openUrlsAsPlaceholders",
        items: toOpen,
        // Successfully opened entries leave History. Failed entries remain so
        // the user can retry them later.
        removeFromHistory: true,
      }, { timeoutMs: 5 * 60_000 })
      if (res?.error) throw new Error(res.error)
      const openedItems = res?.openedItems || []
      if (openedItems.length) {
        setSelected((prev) => {
          const next = new Set(prev)
          for (const item of openedItems) next.delete(item.url)
          return next
        })
        await load()
      }
      setStatus(
        `Opened ${res?.opened ?? openedItems.length}${res?.failed ? ` · failed ${res.failed}` : ""}`
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  const selectedItems = items.filter((item) => selected.has(item.url))
  const busy = opening || removing || deduping

  const cleanDuplicateUrls = async () => {
    setDeduping(true)
    setStatus("Cleaning duplicate URLs…")
    try {
      const result = await sendMessage<{
        ok?: boolean
        removed?: number
        error?: string
      }>({ type: "dedupeSavedHistory" })
      if (result.error) throw new Error(result.error)
      await load()
      setSelected(new Set())
      setStatus(`Removed ${result.removed || 0} duplicate URL${result.removed === 1 ? "" : "s"}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setDeduping(false)
    }
  }

  const restoreDailySnapshot = async () => {
    const snapshot = snapshots.find((entry) => entry.key === selectedSnapshotKey)
    if (!snapshot) return
    if (
      !window.confirm(
        `Restore the session from ${snapshot.date}? Existing tabs will be regrouped and only missing URLs will be opened.`
      )
    ) return
    setOpening(true)
    setStatus(`Restoring ${snapshot.date}…`)
    try {
      const result = await sendMessage<{
        opened?: number
        regrouped?: number
        failed?: number
        error?: string
      }>({
        type: "restoreDailySessionSnapshot",
        storageKey: snapshot.key,
      }, { timeoutMs: 5 * 60_000 })
      if (result.error) throw new Error(result.error)
      setStatus(
        `Restored ${snapshot.date} · regrouped ${result.regrouped || 0} · opened ${result.opened || 0}${result.failed ? ` · failed ${result.failed}` : ""}`
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setOpening(false)
    }
  }

  const removeSelected = async () => {
    if (!selectedItems.length) return
    if (
      !window.confirm(
        `Remove ${selectedItems.length} selected tab${selectedItems.length === 1 ? "" : "s"} from history?`
      )
    ) {
      return
    }
    setRemoving(true)
    setStatus("Removing…")
    const removeKeys = new Set(selectedItems.map((item) => urlKey(item.url)))
    setItems((prev) => prev.filter((item) => !removeKeys.has(urlKey(item.url))))
    setSelected(new Set())
    try {
      const removed = await removeItemsFromLocalHistory(selectedItems)
      await load()
      setStatus(`Removed ${removed}`)
    } catch (e) {
      await load()
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setRemoving(false)
    }
  }

  const selectedFilteredCount = filtered.filter((item) =>
    selected.has(item.url)
  ).length
  const allFilteredSelected =
    filtered.length > 0 && selectedFilteredCount === filtered.length

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const item of filtered) {
        if (allFilteredSelected) next.delete(item.url)
        else next.add(item.url)
      }
      return next
    })
  }

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ closedAndSaved: items }, null, 2)],
      { type: "application/json" }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `tab-hibernate-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as {
        closedAndSaved?: Item[]
        blockedTabsSaved?: Item[]
      }
      const existing = await getLocal<{
        closedAndSaved?: Item[]
        blockedTabsSaved?: Item[]
      }>(["closedAndSaved", "blockedTabsSaved"])
      const merge = (a: Item[] = [], b: Item[] = []) => {
        const out: Item[] = []
        const seen = new Set<string>()
        for (const it of a) {
          const key = it?.url ? urlKey(it.url) : ""
          if (!key || seen.has(key)) continue
          seen.add(key)
          out.push(it)
        }
        for (const it of b) {
          const key = it?.url ? urlKey(it.url) : ""
          if (!key || seen.has(key)) continue
          seen.add(key)
          out.push(it)
        }
        return out
      }
      await setLocal({
        closedAndSaved: merge(existing.closedAndSaved, data.closedAndSaved),
        blockedTabsSaved: merge(
          existing.blockedTabsSaved,
          data.blockedTabsSaved
        ),
      })
      setStatus("Import done")
      await load()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="px-6 py-5">
        <h1 className="mb-4 text-lg font-semibold tracking-tight">
          Tab Hibernate — History
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !selectedItems.length}
            onClick={() => void openItems(selectedItems)}
          >
            {opening ? "Opening…" : `Open selected (${selectedItems.length})`}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !filtered.length}
            onClick={() => void openItems(filtered)}
          >
            Open all{filter ? " filtered" : ""}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !selectedItems.length}
            onClick={() => void removeSelected()}
          >
            {removing
              ? "Removing…"
              : `Remove selected (${selectedItems.length})`}
          </Button>
          <Button variant="secondary" onClick={exportJson}>
            Export JSON
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !items.length}
            onClick={() => void cleanDuplicateUrls()}
          >
            {deduping ? "Cleaning…" : "Clean duplicate URLs"}
          </Button>
          <Button variant="secondary" asChild>
            <label className="cursor-pointer">
              Import JSON
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importJson(f)
                }}
              />
            </label>
          </Button>
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <label htmlFor="history-filter" className="sr-only">
          Filter saved tabs by URL or title
        </label>
        <Input
          id="history-filter"
          type="search"
          className="mt-3 max-w-md"
          placeholder="Filter URL or title…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <section className="mt-4 max-w-2xl rounded-xl bg-card p-4">
          <div className="mb-3">
            <h2 className="text-sm font-medium">Daily session recovery</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              One recovery point per day, including tab groups. The newest 30 days are kept automatically.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Daily session recovery point"
              className="min-h-9 min-w-64 rounded-lg bg-secondary px-3 text-sm text-foreground disabled:opacity-50"
              disabled={busy || !snapshots.length}
              value={selectedSnapshotKey}
              onChange={(event) => setSelectedSnapshotKey(event.target.value)}
            >
              {!snapshots.length ? <option value="">No recovery points yet</option> : null}
              {snapshots.map((snapshot) => (
                <option key={snapshot.key} value={snapshot.key}>
                  {snapshot.date} · {snapshot.count || 0} tabs · {snapshot.groupCount || 0} groups
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={busy || !selectedSnapshotKey}
              onClick={() => void restoreDailySnapshot()}
            >
              Restore session
            </Button>
          </div>
        </section>
        <p
          role="status"
          aria-live="polite"
          className="mt-2 min-h-5 text-sm text-muted-foreground"
        >
          {status}
        </p>
      </header>
      <main className="flex-1 overflow-auto p-6" aria-busy={busy}>
        <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {filtered.length} recoverable URLs
          </p>
          {filtered.length ? (
            <label className="flex min-h-8 cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={
                  allFilteredSelected
                    ? true
                    : selectedFilteredCount > 0
                      ? "indeterminate"
                      : false
                }
                disabled={busy}
                onCheckedChange={toggleAllFiltered}
              />
              Select all{filter ? " filtered" : ""}
            </label>
          ) : null}
        </div>
        <Separator className="mb-3" />
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.url}
              className="flex items-start gap-3 rounded-xl bg-card p-3"
            >
              <Checkbox
                checked={selected.has(item.url)}
                disabled={busy}
                aria-label={`Select ${item.title || item.url}`}
                onCheckedChange={() => toggle(item.url)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {item.title || item.url}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.url}
                </div>
                {item.source ? (
                  <div className="mt-1 text-[10px] text-muted-foreground uppercase">
                    {item.source}
                    {item.groupKey
                      ? ` · group: ${item.groupTitle || "Untitled"}`
                      : ""}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!filtered.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No saved URLs yet.
          </p>
        ) : null}
      </main>
    </div>
  )
}
