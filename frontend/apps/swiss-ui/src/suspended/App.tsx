import { type MouseEvent, useEffect, useMemo, useState } from "react"
import { OpenNewWindow, Refresh } from "iconoir-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { sendMessage } from "@/lib/chrome"
import { useUiTheme } from "@/lib/use-ui-theme"

export function SuspendedApp() {
  useUiTheme()
  const params = new URLSearchParams(window.location.search)
  const tabIdRaw = params.get("tabId")
  const tabId = tabIdRaw ? parseInt(tabIdRaw, 10) : null
  const fallbackUrl = params.get("u") || ""
  const [url, setUrl] = useState(fallbackUrl)
  const [title, setTitle] = useState("Suspended tab")
  const [favIconUrl, setFavIconUrl] = useState("")
  const [previewDataUrl, setPreviewDataUrl] = useState("")
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [faviconFailed, setFaviconFailed] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [status, setStatus] = useState("")

  const domain = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return url
    }
  }, [url])

  const fallbackFaviconUrl = useMemo(() => {
    if (!url) return ""
    try {
      const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"))
      faviconUrl.searchParams.set("pageUrl", url)
      faviconUrl.searchParams.set("size", "64")
      return faviconUrl.toString()
    } catch {
      return ""
    }
  }, [url])

  const applyRestoreData = (res?: {
    url?: string
    title?: string
    favIconUrl?: string
    previewDataUrl?: string
  } | null) => {
    if (res?.url) setUrl(res.url)
    if (res?.title) setTitle(res.title)
    if (res?.favIconUrl) setFavIconUrl(res.favIconUrl)
    if (res?.previewDataUrl) setPreviewDataUrl(res.previewDataUrl)
  }

  useEffect(() => {
    // One resolver already checks the current tab id, the id encoded in the
    // placeholder URL, and the recovery index. A second parallel storage
    // request raced it and could swap the preview/favicon after first paint.
    void sendMessage<{
      url?: string
      title?: string
      favIconUrl?: string
      previewDataUrl?: string
    } | null>({
      type: "resolvePlaceholderData",
      tabId,
      fallbackUrl,
    })
      .then(applyRestoreData)
      .catch(() => {
        if (fallbackUrl) setUrl(fallbackUrl)
      })
  }, [tabId, fallbackUrl])

  const restore = async () => {
    if (restoring) return
    if (!url) {
      setStatus("No URL to restore")
      return
    }
    setRestoring(true)
    setStatus("Restoring…")
    try {
      const result = await sendMessage<{
        ok?: boolean
        error?: string
        navigateUrl?: string
      }>({
        type: "restoreSuspendedTab",
        tabId,
        url,
      })
      if (!result?.ok) throw new Error(result?.error || "Could not restore tab")
      if (!result.navigateUrl) throw new Error("Restore URL unavailable")
      window.location.replace(result.navigateUrl)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      setRestoring(false)
    }
  }

  const handlePageClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return
    void restore()
  }

  const visibleFavicon = faviconFailed ? fallbackFaviconUrl : favIconUrl || fallbackFaviconUrl
  const hasScreenshot = Boolean(previewDataUrl && !imageFailed)

  useEffect(() => {
    if (!visibleFavicon) return

    let cancelled = false
    const link =
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ??
      document.createElement("link")
    link.rel = "icon"
    link.type = "image/png"
    link.dataset.suspendedFavicon = "true"
    if (!link.isConnected) document.head.append(link)

    const favicon = new Image()
    favicon.onload = () => {
      if (cancelled) return
      const canvas = document.createElement("canvas")
      canvas.width = 32
      canvas.height = 32
      const context = canvas.getContext("2d")
      if (!context) return
      context.filter = "grayscale(1)"
      context.drawImage(favicon, 0, 0, 32, 32)
      try {
        link.href = canvas.toDataURL("image/png")
      } catch {
        link.href = visibleFavicon
      }
    }
    favicon.src = visibleFavicon

    return () => {
      cancelled = true
      favicon.onload = null
    }
  }, [visibleFavicon])

  return (
    <main
      className="relative flex min-h-svh cursor-pointer items-center justify-center overflow-hidden bg-background p-4 text-foreground sm:p-8"
      onClick={handlePageClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,color-mix(in_oklch,var(--muted),transparent_45%),transparent_55%)]" />

      <Card className="relative w-full max-w-3xl gap-0 overflow-hidden rounded-3xl p-0 shadow-2xl">
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          <div className="flex size-full flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_50%_20%,color-mix(in_oklch,var(--primary),transparent_78%),transparent_62%)] p-8 text-center">
            {visibleFavicon ? (
              <img
                src={visibleFavicon}
                alt=""
                className="size-16 rounded-2xl bg-background/80 p-2 opacity-75 grayscale shadow-lg"
                onError={() => setFaviconFailed(true)}
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-2xl bg-background/80 text-2xl font-semibold uppercase shadow-lg">
                {(domain || "?").slice(0, 1)}
              </div>
            )}
            <p className="max-w-md truncate text-lg font-medium">{domain || "Saved page"}</p>
          </div>
          {hasScreenshot ? (
            <img
              src={previewDataUrl}
              alt=""
              className={`absolute inset-0 size-full object-cover grayscale-[0.25] transition-opacity duration-150 motion-reduce:transition-none ${previewLoaded ? "opacity-75" : "opacity-0"}`}
              onLoad={() => setPreviewLoaded(true)}
              onError={() => setImageFailed(true)}
            />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-5 sm:p-6">
            {visibleFavicon ? (
              <img
                src={visibleFavicon}
                alt=""
                className="size-10 rounded-xl bg-background/80 p-1.5 opacity-75 grayscale shadow-md"
                onError={() => setFaviconFailed(true)}
              />
            ) : null}
            <div className="min-w-0 text-shadow-sm">
              <p className="text-xs text-foreground/70">Tab suspended</p>
              <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:p-6">
          <CardHeader className="gap-1 p-0">
            <CardTitle className="text-base">Ready to continue?</CardTitle>
            <CardDescription className="truncate" title={url}>
              {domain || "No saved URL"}
            </CardDescription>
          </CardHeader>
          <Button
            className="w-full active:scale-[0.96] transition-transform"
            size="lg"
            disabled={restoring || !url}
            onClick={() => void restore()}
          >
            <Refresh aria-hidden="true" />
            {restoring ? "Restoring…" : "Restore tab"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Click anywhere on the page to restore</span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Open in new tab
                <OpenNewWindow className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <p role="status" aria-live="polite" className="min-h-4 text-center text-xs text-muted-foreground">
            {status}
          </p>
        </div>
      </Card>
    </main>
  )
}
