export function sendMessage<T = unknown>(
  msg: Record<string, unknown>,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error("chrome.runtime unavailable"))
      return
    }
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error("Extension did not respond. Reload it and try again."))
    }, options.timeoutMs ?? 30_000)
    chrome.runtime.sendMessage(msg, (res) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(res as T)
    })
  })
}

export function installDevChromeMock() {
  if (!import.meta.env.DEV || globalThis.chrome?.storage?.local) return

  const values: Record<string, unknown> = {}
  const listeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => void
  >()

  const local = {
    async get(keys: string | string[] | null) {
      if (keys === null) return { ...values }
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(
        list.filter((key) => key in values).map((key) => [key, values[key]])
      )
    },
    async set(next: Record<string, unknown>) {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [key, value] of Object.entries(next)) {
        changes[key] = { oldValue: values[key], newValue: value }
        values[key] = value
      }
      listeners.forEach((listener) => listener(changes, "local"))
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) delete values[key]
    },
  }

  const mock = {
    storage: {
      local,
      onChanged: {
        addListener(listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) {
          listeners.add(listener)
        },
        removeListener(listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) {
          listeners.delete(listener)
        },
      },
    },
    runtime: {
      lastError: undefined,
      getURL: (path: string) =>
        new URL(path.replace(/^\//, ""), `${window.location.origin}/`).toString(),
      sendMessage(
        message: Record<string, unknown>,
        callback: (response: Record<string, unknown>) => void
      ) {
        const type = String(message.type || "")
        const response =
          type === "discardBackgroundTabs"
            ? { discarded: 3 }
            : type === "capture"
              ? { ok: true, count: 1 }
              : type === "saveBlockedTabsNow"
                ? { count: 0 }
                : { ok: true }
        window.setTimeout(() => callback(response), 80)
      },
    },
    tabs: {
      create: async () => undefined,
      query: async () => [
        { id: 1, windowId: 1, title: "Swiss Extensions", url: "https://github.com/navorina-labs/SwissExtensions", active: true },
        { id: 2, windowId: 1, title: "Chrome Extensions documentation", url: "https://developer.chrome.com/docs/extensions", active: false },
        { id: 3, windowId: 1, title: "Design notes", url: "https://www.notion.so/design-notes", active: false },
      ],
      update: async () => undefined,
      reload: async () => undefined,
      sendMessage: async () => ({ ok: true }),
    },
    windows: {
      update: async () => undefined,
    },
    bookmarks: {
      search: async () => [
        { id: "b1", title: "Swiss typography", url: "https://www.typography.com/" },
      ],
      getRecent: async () => [
        { id: "b1", title: "Swiss typography", url: "https://www.typography.com/", dateAdded: Date.now() },
        { id: "b2", title: "Chrome Web Store", url: "https://chromewebstore.google.com/", dateAdded: Date.now() - 60_000 },
      ],
    },
    history: {
      search: async () => [
        { id: "h1", title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", lastVisitTime: Date.now() - 120_000 },
      ],
    },
    browsingData: {
      remove: async () => undefined,
    },
    scripting: {
      executeScript: async () => [],
    },
  }

  if (globalThis.chrome) {
    Object.assign(globalThis.chrome, mock)
  } else {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: mock,
    })
  }
}

export async function getLocal<T extends Record<string, unknown>>(
  keys: string | string[] | null
): Promise<T> {
  return (await chrome.storage.local.get(keys)) as T
}

export async function setLocal(data: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(data)
}

export function applyDocumentTheme(theme: "dark" | "light") {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme)
  root.setAttribute("data-theme", theme)
}

export function getCachedUiTheme(): "dark" | "light" {
  try {
    return window.localStorage.getItem("uiTheme") === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

export function cacheUiTheme(theme: "dark" | "light") {
  try {
    window.localStorage.setItem("uiTheme", theme)
  } catch {
    // Storage can be unavailable in a partially restored extension page.
  }
}
