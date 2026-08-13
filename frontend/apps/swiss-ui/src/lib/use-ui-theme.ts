import { useEffect, useState } from "react"
import {
  applyDocumentTheme,
  cacheUiTheme,
  getCachedUiTheme,
  getLocal,
  setLocal,
} from "@/lib/chrome"

const UI_THEME_KEY = "uiTheme"

export function useUiTheme() {
  const [theme, setThemeState] = useState<"dark" | "light">(getCachedUiTheme)

  useEffect(() => {
    let cancelled = false
    getLocal<Record<string, string>>([UI_THEME_KEY]).then((r) => {
      if (cancelled) return
      const next = r[UI_THEME_KEY] === "light" ? "light" : "dark"
      setThemeState(next)
      cacheUiTheme(next)
      applyDocumentTheme(next)
    })
    const onChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local" || !changes[UI_THEME_KEY]) return
      const next = changes[UI_THEME_KEY].newValue === "light" ? "light" : "dark"
      setThemeState(next)
      cacheUiTheme(next)
      applyDocumentTheme(next)
    }
    chrome.storage?.onChanged.addListener(onChange)
    return () => {
      cancelled = true
      chrome.storage?.onChanged.removeListener(onChange)
    }
  }, [])

  const setTheme = (next: "dark" | "light") => {
    setThemeState(next)
    cacheUiTheme(next)
    applyDocumentTheme(next)
    void setLocal({ [UI_THEME_KEY]: next })
  }

  return { theme, setTheme }
}
