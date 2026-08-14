import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Progress } from "@workspace/ui/components/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Archive,
  Bookmark,
  Camera,
  ClockRotateRight,
  Cpu,
  Eye,
  FloppyDisk,
  NavArrowDown,
  NavArrowRight,
  Refresh,
  Search,
  Shield,
  Trash,
  WindowTabs,
} from "iconoir-react"
import { PanelHeader, Row, StatusLine } from "@/components/panel-shell"
import { getLocal, sendMessage, setLocal } from "@/lib/chrome"
import {
  commandFaviconUrl,
  type CommandResult,
  openCommandResult,
  searchBrowser,
} from "@/lib/command-search"
import "./side-panel.css"

type View = "home" | "command" | "lens" | "capture" | "tabs" | "memory" | "blocker" | "clear"

type LensSettings = {
  enabled: boolean
  fontScale: number
  cleanPage: boolean
  highContrast: boolean
  reduceMotion: boolean
}

type Settings = {
  enabled: boolean
  timeoutMinutes: number
  mode: string
  checkPeriodMinutes: number
  excludedDomains: string
  suspendPinnedTabs: boolean
  skipGroupedInHibernate: boolean
  smartRulesEnabled: boolean
  smartDefaultMode: string
  smartHeuristicsFallback: boolean
  smartPlaceholderDomains: string
  smartDiscardDomains: string
}

type TmcSettings = {
  skipPinned: boolean
  skipAudible: boolean
  skipIncognito: boolean
  skipGrouped: boolean
  excludedDomains: string
}

type SdcOptions = {
  cookies: boolean
  localStorage: boolean
  sessionStorage: boolean
  cacheStorage: boolean
}

const defaultSettings: Settings = {
  enabled: true,
  timeoutMinutes: 5,
  mode: "placeholder",
  checkPeriodMinutes: 1,
  excludedDomains: "",
  suspendPinnedTabs: true,
  skipGroupedInHibernate: false,
  smartRulesEnabled: false,
  smartDefaultMode: "discard",
  smartHeuristicsFallback: true,
  smartPlaceholderDomains: "",
  smartDiscardDomains: "",
}

const defaultLensSettings: LensSettings = {
  enabled: false,
  fontScale: 115,
  cleanPage: false,
  highContrast: false,
  reduceMotion: false,
}

const blocks: {
  id: View
  title: string
  description: string
  icon: typeof Camera
}[] = [
  {
    id: "command",
    title: "Swiss Command",
    description: "Search tabs, bookmarks, history",
    icon: Search,
  },
  {
    id: "lens",
    title: "Swiss Lens",
    description: "Make websites easier to read",
    icon: Eye,
  },
  {
    id: "capture",
    title: "Page Capture",
    description: "Save as PNG or PDF",
    icon: Camera,
  },
  {
    id: "tabs",
    title: "Tab Hibernate",
    description: "Sleep inactive tabs",
    icon: WindowTabs,
  },
  {
    id: "memory",
    title: "Memory Cleaner",
    description: "Free background RAM",
    icon: Cpu,
  },
  {
    id: "blocker",
    title: "Site Blocker",
    description: "Block distracting sites",
    icon: Shield,
  },
  {
    id: "clear",
    title: "Site Data Clear",
    description: "Clear cookies and storage",
    icon: Trash,
  },
]

function linesToText(list: string[] | string | undefined) {
  if (Array.isArray(list)) return list.join("\n")
  return typeof list === "string" ? list : ""
}

function textToLines(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function SidePanelApp() {
  const [view, setView] = useState<View>("home")
  const back = () => setView("home")

  return (
    <div className="swiss-extension-stage flex h-svh w-full min-w-0 text-xs text-[#202020] [--accent-foreground:#202020] [--accent:#ededeb] [--background:#f8f8f7] [--border:#dededb] [--card-foreground:#202020] [--card:#ffffff] [--foreground:#202020] [--input:#d6d6d2] [--muted-foreground:#73736f] [--muted:#eeeeec] [--primary-foreground:#ffffff] [--primary:#d52b1e] [--ring:#d52b1e] [--secondary-foreground:#202020] [--secondary:#e9e9e6]">
      <div
        className={`swiss-panel ${view === "home" ? "swiss-panel-home" : "swiss-panel-detail"} flex min-h-0 min-w-0 flex-col overflow-hidden`}
      >
        {view === "home" && <HomeView onOpen={setView} />}
        {view === "command" && <CommandView onBack={back} />}
        {view === "lens" && <LensView onBack={back} />}
        {view === "capture" && <CaptureView onBack={back} />}
        {view === "tabs" && <TabsView onBack={back} />}
        {view === "memory" && <MemoryView onBack={back} />}
        {view === "blocker" && <BlockerView onBack={back} />}
        {view === "clear" && <ClearView onBack={back} />}
      </div>
    </div>
  )
}

function HomeView({
  onOpen,
}: {
  onOpen: (v: View) => void
}) {
  return (
    <main className="swiss-scroll flex-1 overflow-y-auto p-3">
      <h1 className="sr-only">Swiss Extensions tools</h1>
      <div className="home-shell">
        <div className="tool-island-grid">
          {blocks.map((b, index) => {
            const Icon = b.icon

            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpen(b.id)}
                className={`tool-island group${blocks.length % 2 === 1 && index === blocks.length - 1 ? " tool-island-wide" : ""}`}
              >
                <span aria-hidden="true" className="tool-island-icon">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug font-semibold tracking-[-0.015em]">
                    {b.title}
                  </span>
                  <span className="mt-1 block text-[12px] leading-[1.35] text-muted-foreground text-pretty">
                    {b.description}
                  </span>
                </span>
                <NavArrowRight
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-[#9b9b98] transition-colors duration-150 group-hover:text-[#555]"
                />
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}

function CommandView({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CommandResult[]>([])
  const [selected, setSelected] = useState(0)
  const [status, setStatus] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      void searchBrowser(query)
        .then((next) => {
          if (!current) return
          setResults(next)
          setSelected(0)
          setStatus(next.length ? `${next.length} results` : "No matching results")
        })
        .catch((error) => {
          if (current) setStatus(error instanceof Error ? error.message : String(error))
        })
    }, 90)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [query])

  const open = async (result: CommandResult) => {
    try {
      await openCommandResult(result)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <PanelHeader title="Swiss Command" onBack={onBack} />
      <main className="command-workspace swiss-scroll flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="command-search-wrap">
          <Search aria-hidden="true" className="size-[19px] shrink-0 text-muted-foreground" />
          <label htmlFor="swiss-command-search" className="sr-only">
            Search open tabs, bookmarks, and history
          </label>
          <input
            ref={inputRef}
            id="swiss-command-search"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="swiss-command-results"
            aria-expanded="true"
            aria-activedescendant={results[selected] ? `swiss-command-result-${selected}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search your browser…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setSelected((value) => Math.min(results.length - 1, value + 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setSelected((value) => Math.max(0, value - 1))
              } else if (event.key === "Enter" && results[selected]) {
                event.preventDefault()
                void open(results[selected])
              } else if (event.key === "Escape") {
                event.preventDefault()
                if (query) setQuery("")
                else onBack()
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="command-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        <p className="command-status" role="status" aria-live="polite">
          {status}
        </p>
        <ul
          id="swiss-command-results"
          className="command-result-list swiss-scroll"
          role="listbox"
          aria-label="Search results"
        >
          {results.map((result, index) => (
            <li
              key={`${result.kind}-${result.id}-${result.url}`}
              id={`swiss-command-result-${index}`}
              role="option"
              aria-selected={index === selected}
              className="command-result"
              onMouseMove={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void open(result)}
            >
              <span className="command-result-icon" aria-hidden="true">
                {result.kind === "tab" ? (
                  <>
                    <WindowTabs className="size-[17px]" />
                    <img
                      src={commandFaviconUrl(result.url)}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.hidden = true
                      }}
                    />
                  </>
                ) : result.kind === "bookmark" ? (
                  <Bookmark className="size-[17px]" />
                ) : (
                  <ClockRotateRight className="size-[17px]" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-tight font-semibold tracking-[-0.01em]">
                  {result.title || result.host}
                </span>
                <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                  {result.host || result.url}
                </span>
              </span>
              <span className="text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
                {result.kind}
              </span>
            </li>
          ))}
          {!results.length ? (
            <li className="command-empty">
              {query ? "No matching tabs, bookmarks, or history." : "Your browser activity will appear here."}
            </li>
          ) : null}
        </ul>
        <div className="command-hints" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> Select</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>esc</kbd> Clear</span>
        </div>
      </main>
    </>
  )
}

function LensView({ onBack }: { onBack: () => void }) {
  const [siteKey, setSiteKey] = useState("")
  const [tabId, setTabId] = useState<number | null>(null)
  const [settings, setSettings] = useState<LensSettings>(defaultLensSettings)
  const [status, setStatus] = useState("Loading current site…")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        let host = ""
        try {
          const parsed = new URL(tab?.url || "")
          if (parsed.protocol === "http:" || parsed.protocol === "https:") host = parsed.hostname
        } catch {
          host = ""
        }
        setTabId(tab?.id ?? null)
        setSiteKey(host)
        if (!host) {
          setStatus("Swiss Lens is unavailable on this page.")
          return
        }
        const data = await getLocal<{ swissLensProfiles?: Record<string, LensSettings> }>("swissLensProfiles")
        setSettings({ ...defaultLensSettings, ...(data.swissLensProfiles?.[host] || {}) })
        setStatus(`Settings for ${host}`)
      })().catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const save = async (next: LensSettings) => {
    if (!siteKey) return
    const safe: LensSettings = {
      enabled: next.enabled === true,
      fontScale: Math.min(180, Math.max(100, Number(next.fontScale) || 115)),
      cleanPage: next.cleanPage === true,
      highContrast: next.highContrast === true,
      reduceMotion: next.reduceMotion === true,
    }
    setSettings(safe)
    const data = await getLocal<{ swissLensProfiles?: Record<string, LensSettings> }>("swissLensProfiles")
    await setLocal({
      swissLensProfiles: { ...(data.swissLensProfiles || {}), [siteKey]: safe },
    })
    if (tabId != null) {
      await chrome.tabs.sendMessage(tabId, { type: "swissLensApply", settings: safe }).catch(() => undefined)
    }
    setStatus(safe.enabled ? `Applied to ${siteKey}` : `Lens is off for ${siteKey}`)
  }

  const disabled = !siteKey

  return (
    <>
      <PanelHeader title="Swiss Lens" onBack={onBack} />
      <div className="swiss-scroll flex-1 space-y-3 overflow-y-auto p-4">
        <Card className="gap-0 p-3 py-1">
          <Row label="Improve readability">
            <Switch
              aria-label="Improve readability on this site"
              checked={settings.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => void save({ ...settings, enabled })}
            />
          </Row>
        </Card>

        <section aria-labelledby="lens-text-title" className="space-y-2">
          <div className="px-1">
            <h2 id="lens-text-title" className="text-xs font-semibold">Text</h2>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{siteKey || "Open a regular website to use Swiss Lens."}</p>
          </div>
          <Card className="gap-3 p-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="lens-font-scale" className="text-xs">Text size</Label>
              <output htmlFor="lens-font-scale" className="text-[11px] text-muted-foreground tabular-nums">{settings.fontScale}%</output>
            </div>
            <input
              id="lens-font-scale"
              className="lens-range"
              type="range"
              min="100"
              max="180"
              step="5"
              value={settings.fontScale}
              disabled={disabled || !settings.enabled}
              onChange={(event) => void save({ ...settings, fontScale: Number(event.target.value) })}
            />
          </Card>
        </section>

        <section aria-labelledby="lens-display-title" className="space-y-2">
          <h2 id="lens-display-title" className="px-1 text-xs font-semibold">Display</h2>
          <Card className="gap-0 p-3 py-1">
            <Row label="Clean page">
              <Switch aria-label="Hide sidebars and common distractions" checked={settings.cleanPage} disabled={disabled || !settings.enabled} onCheckedChange={(cleanPage) => void save({ ...settings, cleanPage })} />
            </Row>
            <Row label="High contrast">
              <Switch aria-label="Use a high contrast reading theme" checked={settings.highContrast} disabled={disabled || !settings.enabled} onCheckedChange={(highContrast) => void save({ ...settings, highContrast })} />
            </Row>
            <Row label="Reduce motion">
              <Switch aria-label="Reduce animations and smooth scrolling" checked={settings.reduceMotion} disabled={disabled || !settings.enabled} onCheckedChange={(reduceMotion) => void save({ ...settings, reduceMotion })} />
            </Row>
          </Card>
        </section>

        <Button variant="secondary" className="h-10 w-full rounded-xl active:scale-[0.96]" disabled={disabled} onClick={() => void save(defaultLensSettings)}>
          Reset this site
        </Button>
        <StatusLine>{status}</StatusLine>
      </div>
    </>
  )
}

function CaptureView({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState("")
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local" || !changes.captureProgress?.newValue) return
      const { total, current } = changes.captureProgress.newValue as {
        total: number
        current: number
      }
      setProgress({ total, current })
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  const scan = async () => {
    setBusy(true)
    setStatus("Scanning…")
    setProgress(null)
    try {
      const res = await sendMessage<{
        ok?: boolean
        error?: string
        count?: number
      }>({
        type: "capture",
      })
      if (res?.error) setStatus(res.error)
      else setStatus(res?.count ? `Captured ${res.count} frames.` : "Done.")
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
      void chrome.storage.local.remove("captureProgress")
    }
  }

  return (
    <>
      <PanelHeader title="Page Capture" onBack={onBack} />
      <div className="swiss-scroll flex-1 overflow-y-auto p-4">
        <Card className="gap-4 p-4 py-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="tool-island-icon shrink-0">
              <Camera className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.015em]">
                Capture the full page
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                Save the current page as a stitched PNG or PDF.
              </p>
            </div>
          </div>
          <Button
            className="h-10 w-full rounded-xl"
            disabled={busy}
            onClick={() => void scan()}
          >
            {busy ? "Capturing…" : "Capture page"}
          </Button>
          {progress && progress.total > 0 ? (
            <div className="space-y-1.5">
              <Progress value={(progress.current / progress.total) * 100} />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {progress.current} of {progress.total} sections
              </p>
            </div>
          ) : null}
          <StatusLine>{status}</StatusLine>
        </Card>
      </div>
    </>
  )
}

function TabsView({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings>(defaultSettings)
  const [status, setStatus] = useState("")
  const [restore, setRestore] = useState<{
    done: number
    total: number
  } | null>(null)

  const load = useCallback(async () => {
    const data = await getLocal<{
      settings?: Partial<Settings> & Record<string, unknown>
    }>(["settings"])
    const raw = data.settings || {}
    setS({
      ...defaultSettings,
      enabled: raw.enabled !== false,
      timeoutMinutes: Number(raw.timeoutMinutes) || 5,
      mode: String(raw.mode || "placeholder"),
      checkPeriodMinutes: Number(raw.checkPeriodMinutes) || 1,
      excludedDomains: linesToText(
        (raw.excludedDomains as string[] | string | undefined) ?? ""
      ),
      suspendPinnedTabs: raw.suspendPinnedTabs !== false,
      skipGroupedInHibernate: raw.skipGroupedInHibernate === true,
      smartRulesEnabled: raw.smartRulesEnabled === true,
      smartDefaultMode: String(raw.smartDefaultMode || "discard"),
      smartHeuristicsFallback: raw.smartHeuristicsFallback !== false,
      smartPlaceholderDomains: linesToText(
        raw.smartPlaceholderDomains as string[] | string | undefined
      ),
      smartDiscardDomains: linesToText(
        raw.smartDiscardDomains as string[] | string | undefined
      ),
    })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const save = async (next: Settings) => {
    setS(next)
    const payload = {
      ...next,
      excludedDomains: textToLines(next.excludedDomains),
      smartPlaceholderDomains: textToLines(next.smartPlaceholderDomains),
      smartDiscardDomains: textToLines(next.smartDiscardDomains),
    }
    await setLocal({ settings: payload })
    void sendMessage({ type: "settingsUpdated" }).catch(() => {})
  }

  const patch = (partial: Partial<Settings>) => {
    void save({ ...s, ...partial })
  }

  const run = async (
    type: string,
    okMsg: string,
    extra: Record<string, unknown> = {}
  ) => {
    setStatus("…")
    try {
      const r = await sendMessage<{
        error?: string
        count?: number
        suspended?: number
      }>({
        type,
        ...extra,
      })
      if (r?.error) setStatus(r.error)
      else setStatus(okMsg)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    const onChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local" || !changes.restoreProgress?.newValue) return
      const p = changes.restoreProgress.newValue as {
        done: number
        total: number
      }
      setRestore(p)
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  return (
    <>
      <PanelHeader title="Tab Hibernate" onBack={onBack} />
      <div className="swiss-scroll flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 pb-6">
          <section aria-labelledby="hibernate-status-title">
            <Card size="sm" className="gap-0 py-0">
              <CardHeader className="items-center py-3">
                <CardTitle id="hibernate-status-title">
                  Automatic hibernation
                </CardTitle>
                <CardDescription className="text-xs">
                  Suspend inactive tabs to reduce memory use.
                </CardDescription>
                <CardAction className="self-center">
                  <Switch
                    id="hibernate-enabled"
                    aria-label="Enable automatic hibernation"
                    checked={s.enabled}
                    onCheckedChange={(v) => patch({ enabled: v })}
                  />
                </CardAction>
              </CardHeader>
            </Card>
          </section>

          <section aria-labelledby="automation-title" className="space-y-2">
            <div>
              <h2 id="automation-title" className="text-xs font-semibold">
                Automation
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Choose when and how inactive tabs are handled.
              </p>
            </div>
            <Card size="sm" className="gap-0 py-0">
              <CardContent className="grid grid-cols-2 gap-3 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor="hibernate-timeout" className="text-xs">
                    After
                  </Label>
                  <Select
                    value={String(s.timeoutMinutes)}
                    onValueChange={(v) => patch({ timeoutMinutes: Number(v) })}
                  >
                    <SelectTrigger id="hibernate-timeout" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} min
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hibernate-check-period" className="text-xs">
                    Check every
                  </Label>
                  <Select
                    value={String(s.checkPeriodMinutes)}
                    onValueChange={(v) =>
                      patch({ checkPeriodMinutes: Number(v) })
                    }
                  >
                    <SelectTrigger
                      id="hibernate-check-period"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 min</SelectItem>
                      <SelectItem value="2">2 min</SelectItem>
                      <SelectItem value="5">5 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="hibernate-mode" className="text-xs">
                    Hibernation mode
                  </Label>
                  <Select
                    value={s.mode}
                    onValueChange={(v) => patch({ mode: v })}
                  >
                    <SelectTrigger id="hibernate-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discard">Discard tab</SelectItem>
                      <SelectItem value="placeholder">
                        Show placeholder
                      </SelectItem>
                      <SelectItem value="smart">
                        Choose automatically
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
              <Separator />
              <CardContent className="space-y-1 py-2">
                <label
                  htmlFor="hibernate-pinned"
                  className="flex min-h-10 cursor-pointer items-center justify-between gap-3"
                >
                  <span>
                    <span className="block text-xs font-medium">
                      Include pinned tabs
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      Allow pinned tabs to hibernate.
                    </span>
                  </span>
                  <Switch
                    id="hibernate-pinned"
                    checked={s.suspendPinnedTabs}
                    onCheckedChange={(v) => patch({ suspendPinnedTabs: v })}
                  />
                </label>
                <label
                  htmlFor="hibernate-skip-groups"
                  className="flex min-h-10 cursor-pointer items-center justify-between gap-3"
                >
                  <span>
                    <span className="block text-xs font-medium">
                      Protect tab groups
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      Keep grouped tabs active.
                    </span>
                  </span>
                  <Switch
                    id="hibernate-skip-groups"
                    checked={s.skipGroupedInHibernate}
                    onCheckedChange={(v) =>
                      patch({ skipGroupedInHibernate: v })
                    }
                  />
                </label>
              </CardContent>
              <Separator />
              <CardContent className="space-y-1.5 py-3">
                <Label htmlFor="hibernate-excluded-domains" className="text-xs">
                  Never hibernate these domains
                </Label>
                <Textarea
                  id="hibernate-excluded-domains"
                  value={s.excludedDomains}
                  onChange={(e) =>
                    setS({ ...s, excludedDomains: e.target.value })
                  }
                  onBlur={() => void save(s)}
                  placeholder={"mail.google.com\nweb.telegram.org"}
                  className="min-h-16 resize-y text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Enter one domain per line.
                </p>
              </CardContent>
            </Card>
          </section>

          {s.mode === "smart" ? (
            <section aria-labelledby="smart-rules-title" className="space-y-2">
              <div>
                <h2 id="smart-rules-title" className="text-xs font-semibold">
                  Smart rules
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Override automatic choices for specific domains.
                </p>
              </div>
              <Card size="sm" className="gap-3 p-3">
                <label
                  htmlFor="smart-rules-enabled"
                  className="flex min-h-9 cursor-pointer items-center justify-between gap-3"
                >
                  <span className="text-xs font-medium">Use domain rules</span>
                  <Switch
                    id="smart-rules-enabled"
                    checked={s.smartRulesEnabled}
                    onCheckedChange={(v) => patch({ smartRulesEnabled: v })}
                  />
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="smart-fallback" className="text-xs">
                    Default action
                  </Label>
                  <Select
                    value={s.smartDefaultMode}
                    onValueChange={(v) => patch({ smartDefaultMode: v })}
                  >
                    <SelectTrigger id="smart-fallback" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discard">Discard tab</SelectItem>
                      <SelectItem value="placeholder">
                        Show placeholder
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="smart-placeholder-domains"
                    className="text-xs"
                  >
                    Always show a placeholder
                  </Label>
                  <Textarea
                    id="smart-placeholder-domains"
                    value={s.smartPlaceholderDomains}
                    onChange={(e) =>
                      setS({ ...s, smartPlaceholderDomains: e.target.value })
                    }
                    onBlur={() => void save(s)}
                    placeholder="example.com"
                    className="min-h-12 resize-y text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smart-discard-domains" className="text-xs">
                    Always discard
                  </Label>
                  <Textarea
                    id="smart-discard-domains"
                    value={s.smartDiscardDomains}
                    onChange={(e) =>
                      setS({ ...s, smartDiscardDomains: e.target.value })
                    }
                    onBlur={() => void save(s)}
                    placeholder="example.com"
                    className="min-h-12 resize-y text-xs"
                  />
                </div>
              </Card>
            </section>
          ) : null}

          <section aria-labelledby="tab-actions-title" className="space-y-2">
            <div>
              <h2 id="tab-actions-title" className="text-xs font-semibold">
                Quick actions
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Manage tabs without changing automation settings.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => void run("suspendCurrentTab", "Tab suspended")}
              >
                Suspend tab
              </Button>
              <Button
                variant="secondary"
                onClick={() => void run("suspendAllNow", "All tabs suspended")}
              >
                Suspend all
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setStatus("Restoring tabs…")
                  try {
                    await sendMessage({ type: "restoreAllSuspended" })
                    setStatus("Restore started")
                  } catch (e) {
                    setStatus(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                <Refresh />
                Restore tabs
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  chrome.tabs.create({
                    url: chrome.runtime.getURL("ui-dist/history.html"),
                  })
                }
              >
                <ClockRotateRight />
                Open history
              </Button>
            </div>
            {restore ? (
              <Badge variant="outline">
                Restored {restore.done}/{restore.total}
              </Badge>
            ) : null}
            <p
              role="status"
              aria-live="polite"
              className="min-h-4 text-[11px] text-muted-foreground"
            >
              {status}
            </p>
          </section>

          <section aria-labelledby="tab-groups-title" className="space-y-2">
            <div>
              <h2 id="tab-groups-title" className="text-xs font-semibold">
                Tab groups
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Organize or save related tabs as a set.
              </p>
            </div>
            <Card size="sm" className="grid grid-cols-2 gap-2 p-2">
              <Button
                variant="ghost"
                onClick={() =>
                  void run("groupTabsByDomain", "Tabs grouped by domain")
                }
              >
                Group by domain
              </Button>
              <Button
                variant="ghost"
                onClick={() => void run("saveTabGroup", "Group saved")}
              >
                <FloppyDisk />
                Save group
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void run("closeTabGroupAndSave", "Group closed and saved")
                }
              >
                Close and save group
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void run("closeAndSaveAllAsync", "Closing and saving tabs…")
                }
              >
                Close and save all
              </Button>
            </Card>
          </section>

          <details className="group rounded-2xl bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium [&::-webkit-details-marker]:hidden">
              <Archive className="size-4 text-muted-foreground" />
              Backups and recovery
              <NavArrowDown className="ms-auto size-4 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform" />
            </summary>
            <div className="grid gap-2 px-3 pb-3">
              <Button
                variant="outline"
                onClick={() => void run("backupNow", "Tabs backed up")}
              >
                Back up tabs
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run("recoverLostSuspended", "Lost tabs recovered")
                }
              >
                Recover lost tabs
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run("emergencyBackupNow", "Emergency backup created")
                }
              >
                Create emergency backup
              </Button>
            </div>
          </details>
        </div>
      </div>
    </>
  )
}

function MemoryView({ onBack }: { onBack: () => void }) {
  const [m, setM] = useState<TmcSettings>({
    skipPinned: false,
    skipAudible: true,
    skipIncognito: true,
    skipGrouped: false,
    excludedDomains: "",
  })
  const [status, setStatus] = useState("")

  useEffect(() => {
    void getLocal<{ tmcSettings?: Partial<TmcSettings> }>(["tmcSettings"]).then(
      (data) => {
        const raw = data.tmcSettings || {}
        setM({
          skipPinned: raw.skipPinned === true,
          skipAudible: raw.skipAudible !== false,
          skipIncognito: raw.skipIncognito !== false,
          skipGrouped: raw.skipGrouped === true,
          excludedDomains: linesToText(raw.excludedDomains),
        })
      }
    )
  }, [])

  const save = async (next: TmcSettings) => {
    setM(next)
    await setLocal({
      tmcSettings: {
        ...next,
        excludedDomains: textToLines(next.excludedDomains),
      },
    })
  }

  return (
    <>
      <PanelHeader title="Memory Cleaner" onBack={onBack} />
      <div className="swiss-scroll flex-1 space-y-4 overflow-y-auto p-4">
        <Card className="gap-4 p-4 py-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="tool-island-icon shrink-0">
              <Cpu className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.015em]">
                Free memory now
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                Discard inactive background tabs without closing them.
              </p>
            </div>
          </div>
          <Button
            className="h-10 w-full rounded-xl"
            onClick={async () => {
              setStatus("…")
              try {
                const r = await sendMessage<{
                  discarded?: number
                  error?: string
                }>({
                  type: "discardBackgroundTabs",
                })
                setStatus(
                  r?.error ||
                    (typeof r?.discarded === "number"
                      ? `Discarded ${r.discarded} tabs`
                      : "Done")
                )
              } catch (e) {
                setStatus(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            Clean background tabs
          </Button>
          <StatusLine>{status}</StatusLine>
        </Card>

        <section aria-labelledby="memory-protection-title" className="space-y-2">
          <h2 id="memory-protection-title" className="px-1 text-xs font-semibold">
            Protect tabs
          </h2>
          <Card className="gap-0 p-3 py-1">
            <Row label="Pinned tabs">
              <Switch
                aria-label="Protect pinned tabs"
                checked={m.skipPinned}
                onCheckedChange={(v) => void save({ ...m, skipPinned: v })}
              />
            </Row>
            <Row label="Tabs playing audio">
              <Switch
                aria-label="Protect tabs playing audio"
                checked={m.skipAudible}
                onCheckedChange={(v) => void save({ ...m, skipAudible: v })}
              />
            </Row>
            <Row label="Incognito tabs">
              <Switch
                aria-label="Protect incognito tabs"
                checked={m.skipIncognito}
                onCheckedChange={(v) => void save({ ...m, skipIncognito: v })}
              />
            </Row>
            <Row label="Grouped tabs">
              <Switch
                aria-label="Protect grouped tabs"
                checked={m.skipGrouped}
                onCheckedChange={(v) => void save({ ...m, skipGrouped: v })}
              />
            </Row>
          </Card>
        </section>

        <section aria-labelledby="memory-exclusions-title" className="space-y-2">
          <div className="px-1">
            <h2 id="memory-exclusions-title" className="text-xs font-semibold">
              Excluded domains
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              One domain per line · Option+Shift+K to clean
            </p>
          </div>
          <Textarea
            aria-label="Domains excluded from memory cleaning"
            value={m.excludedDomains}
            onChange={(e) => setM({ ...m, excludedDomains: e.target.value })}
            onBlur={() => void save(m)}
            placeholder={"mail.google.com\nweb.telegram.org"}
            className="min-h-24 resize-y rounded-xl bg-card text-xs"
          />
        </section>
      </div>
    </>
  )
}

function BlockerView({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useState(true)
  const [autoSave, setAutoSave] = useState(true)
  const [ads, setAds] = useState(true)
  const [blocked, setBlocked] = useState<string[]>([])
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [wlInput, setWlInput] = useState("")
  const [status, setStatus] = useState("")

  const refresh = useCallback(async () => {
    const data = await getLocal<{
      blocked?: string[]
      whitelist?: string[]
      enabled?: boolean
      adsFiltersEnabled?: boolean
      blockerAutoSaveTabs?: boolean
    }>([
      "blocked",
      "whitelist",
      "enabled",
      "adsFiltersEnabled",
      "blockerAutoSaveTabs",
    ])
    setBlocked(data.blocked || [])
    setWhitelist(data.whitelist || [])
    setEnabled(data.enabled !== false)
    setAds(data.adsFiltersEnabled !== false)
    setAutoSave(data.blockerAutoSaveTabs !== false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    const onChange = () => void refresh()
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      window.clearTimeout(timer)
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [refresh])

  const addDomain = async (
    list: string[],
    value: string,
    key: "blocked" | "whitelist"
  ) => {
    const d = value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
    if (!d || list.includes(d)) return
    await setLocal({ [key]: [...list, d] })
  }

  return (
    <>
      <PanelHeader title="Site Blocker" onBack={onBack} />
      <div className="swiss-scroll flex-1 space-y-4 overflow-y-auto p-4">
        <Card className="gap-0 p-3 py-1">
          <Row label="Block distracting sites">
            <Switch
              aria-label="Enable site blocking"
              checked={enabled}
              onCheckedChange={(v) => void setLocal({ enabled: v })}
            />
          </Row>
          <Row label="Save tabs before blocking">
            <Switch
              aria-label="Save tabs before blocking"
              checked={autoSave}
              onCheckedChange={(v) => void setLocal({ blockerAutoSaveTabs: v })}
            />
          </Row>
          <Row label="Ads and tracker filters">
            <Switch
              aria-label="Enable ads and tracker filters"
              checked={ads}
              onCheckedChange={(v) => void setLocal({ adsFiltersEnabled: v })}
            />
          </Row>
        </Card>

        <section aria-labelledby="blocked-sites-title" className="space-y-2">
          <div className="px-1">
            <h2 id="blocked-sites-title" className="text-xs font-semibold">
              Blocked sites
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add a domain without https:// or a path.
            </p>
          </div>
          <Card className="gap-3 p-3 py-3">
            <div className="flex gap-2">
              <Input
                aria-label="Domain to block"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="example.com"
                className="h-10 rounded-xl bg-background text-base sm:text-sm"
              />
              <Button
                className="h-10 rounded-xl px-4"
                onClick={() => {
                  void addDomain(blocked, input, "blocked")
                  setInput("")
                }}
              >
                Add
              </Button>
            </div>
            <ul className="grid gap-1">
              {blocked.map((d) => (
                <li
                  key={d}
                  className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-muted/60 ps-3 text-xs"
                >
                  <span className="min-w-0 truncate">{d}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${d} from blocked sites`}
                    onClick={() =>
                      void setLocal({ blocked: blocked.filter((x) => x !== d) })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {!blocked.length ? (
              <p className="py-2 text-center text-[11px] text-muted-foreground">
                No blocked sites yet
              </p>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="allowed-sites-title" className="space-y-2">
          <div className="px-1">
            <h2 id="allowed-sites-title" className="text-xs font-semibold">
              Always allowed
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              These domains bypass all blocking rules.
            </p>
          </div>
          <Card className="gap-3 p-3 py-3">
            <div className="flex gap-2">
              <Input
                aria-label="Domain to always allow"
                value={wlInput}
                onChange={(e) => setWlInput(e.target.value)}
                placeholder="allowed.com"
                className="h-10 rounded-xl bg-background text-base sm:text-sm"
              />
              <Button
                className="h-10 rounded-xl px-4"
                onClick={() => {
                  void addDomain(whitelist, wlInput, "whitelist")
                  setWlInput("")
                }}
              >
                Add
              </Button>
            </div>
            <ul className="grid gap-1">
              {whitelist.map((d) => (
                <li
                  key={d}
                  className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-muted/60 ps-3 text-xs"
                >
                  <span className="min-w-0 truncate">{d}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${d} from always allowed sites`}
                    onClick={() =>
                      void setLocal({ whitelist: whitelist.filter((x) => x !== d) })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {!whitelist.length ? (
              <p className="py-2 text-center text-[11px] text-muted-foreground">
                No allowed sites yet
              </p>
            ) : null}
          </Card>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="h-10 rounded-xl"
            onClick={async () => {
              try {
                const r = await sendMessage<{ count?: number; error?: string }>({
                  type: "saveBlockedTabsNow",
                })
                setStatus(r?.error || `Saved ${r?.count ?? 0} tabs`)
              } catch (e) {
                setStatus(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            Save blocked tabs
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() =>
              chrome.tabs.create({
                url: chrome.runtime.getURL("ui-dist/history.html"),
              })
            }
          >
            Open history
          </Button>
        </div>
        <StatusLine>{status}</StatusLine>
      </div>
    </>
  )
}

function ClearView({ onBack }: { onBack: () => void }) {
  const [opts, setOpts] = useState<SdcOptions>({
    cookies: true,
    localStorage: true,
    sessionStorage: true,
    cacheStorage: true,
  })
  const [status, setStatus] = useState("")
  const key = "sdcOptions"

  useEffect(() => {
    void getLocal<Record<string, SdcOptions>>([key]).then((data) => {
      if (data[key]) setOpts({ ...opts, ...data[key] })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (next: SdcOptions) => {
    setOpts(next)
    void setLocal({ [key]: next })
  }

  const clear = async () => {
    setStatus("…")
    try {
      const anyBrowsing = opts.cookies || opts.localStorage || opts.cacheStorage
      if (!anyBrowsing && !opts.sessionStorage) {
        setStatus("Select at least one option")
        return
      }
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id || !tab.url) {
        setStatus("No active tab")
        return
      }
      const parsed = new URL(tab.url)
      if (
        parsed.protocol === "chrome:" ||
        parsed.protocol === "chrome-extension:" ||
        parsed.protocol === "edge:" ||
        parsed.protocol === "about:"
      ) {
        setStatus("Unavailable on system pages")
        return
      }
      const dataToRemove: chrome.browsingData.DataTypeSet = {}
      if (opts.cookies) dataToRemove.cookies = true
      if (opts.localStorage) dataToRemove.localStorage = true
      if (opts.cacheStorage) dataToRemove.cacheStorage = true
      if (Object.keys(dataToRemove).length > 0) {
        await chrome.browsingData.remove(
          { origins: [parsed.origin], since: 0 },
          dataToRemove
        )
      }
      if (opts.sessionStorage) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            sessionStorage.clear()
          },
        })
      }
      setStatus("Done")
      setTimeout(() => {
        if (tab.id) void chrome.tabs.reload(tab.id)
      }, 800)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <PanelHeader title="Site Data Clear" onBack={onBack} />
      <div className="swiss-scroll flex-1 space-y-4 overflow-y-auto p-4">
        <Card className="gap-4 p-4 py-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="tool-island-icon shrink-0">
              <Trash className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.015em]">
                Clear data for this site
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                Choose what to remove from the active website.
              </p>
            </div>
          </div>
          <div className="grid gap-1">
            {(
              [
                ["cookies", "Cookies"],
                ["localStorage", "Local storage"],
                ["sessionStorage", "Session storage"],
                ["cacheStorage", "Service worker cache"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-xs hover:bg-muted/60"
              >
                <Checkbox
                  checked={opts[k]}
                  onCheckedChange={(v) => save({ ...opts, [k]: v === true })}
                />
                {label}
              </label>
            ))}
          </div>
          <Button className="h-10 w-full rounded-xl" onClick={() => void clear()}>
            Clear selected data
          </Button>
          <StatusLine>{status}</StatusLine>
        </Card>
      </div>
    </>
  )
}
