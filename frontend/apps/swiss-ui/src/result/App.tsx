import { useEffect, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Progress } from "@workspace/ui/components/progress"
import { jsPDF } from "jspdf"
import { useUiTheme } from "@/lib/use-ui-theme"

type PageInfo = { url?: string; title?: string }
const MAX_CANVAS_DIMENSION = 32767
const MAX_CANVAS_PIXELS = 64 * 1024 * 1024

function validateCanvasSize(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_CANVAS_PIXELS
  ) {
    throw new Error("Capture is too large for one PNG. Download multiple frames instead.")
  }
}

export function ResultApp() {
  useUiTheme()
  const [tiles, setTiles] = useState<string[]>([])
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("Loading…")
  const [exportFolder, setExportFolder] = useState("")
  const [progress, setProgress] = useState(0)
  const [whole, setWhole] = useState(true)
  const mountedRef = useRef(true)
  const objectUrlsRef = useRef(new Set<string>())
  const revokeTimersRef = useRef(new Set<number>())

  const scheduleObjectUrlRevoke = (url: string) => {
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url)
      objectUrlsRef.current.delete(url)
      revokeTimersRef.current.delete(timer)
    }, 2000)
    revokeTimersRef.current.add(timer)
  }

  const downloadBlob = async (blob: Blob, filename: string) => {
    if (!mountedRef.current) return
    const url = URL.createObjectURL(blob)
    objectUrlsRef.current.add(url)
    try {
      await chrome.downloads.download({ url, filename, saveAs: false })
      scheduleObjectUrlRevoke(url)
    } catch (error) {
      URL.revokeObjectURL(url)
      objectUrlsRef.current.delete(url)
      throw error
    }
  }

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    let retryTimer: number | null = null
    const revokeTimers = revokeTimersRef.current
    const objectUrls = objectUrlsRef.current
    chrome.storage.local.get(["exportFolder", "pngFormat"], (data) => {
      if (cancelled) return
      setExportFolder(String(data.exportFolder || ""))
      setWhole(data.pngFormat !== "tiles")
    })
    chrome.runtime.sendMessage({ type: "getTiles" }, (res) => {
      if (cancelled) return
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message || "Error")
        setStatus("")
        return
      }
      if (res?.error) {
        setError(res.error)
        setStatus("")
        return
      }
      const list = res?.tiles || []
      if (!list.length) {
        setStatus("Waiting for data…")
        retryTimer = window.setTimeout(() => {
          chrome.runtime.sendMessage({ type: "getTiles" }, (r2) => {
            if (cancelled) return
            setTiles(r2?.tiles || [])
            setPageInfo(r2?.pageInfo || null)
            setStatus(
              r2?.tiles?.length
                ? `Captured: ${r2.tiles.length} frames`
                : "No frames."
            )
            if (r2?.error) setError(r2.error)
          })
        }, 500)
        return
      }
      setTiles(list)
      setPageInfo(res?.pageInfo || null)
      setStatus(`Captured: ${list.length} frames`)
    })

    return () => {
      cancelled = true
      mountedRef.current = false
      if (retryTimer != null) window.clearTimeout(retryTimer)
      for (const timer of revokeTimers) window.clearTimeout(timer)
      revokeTimers.clear()
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    }
  }, [])

  const fileBase = () => {
    let host = "page-capture"
    if (pageInfo?.url) {
      try {
        const u = new URL(pageInfo.url)
        host = u.hostname
          .replace(/^www\./, "")
          .replace(/[\\/:*?"<>|\s]/g, "_")
          .slice(0, 60)
      } catch {
        /* ignore */
      }
    }
    const now = new Date()
    return `${host}_${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 8).replace(/:/g, "-")}`
  }

  const fullName = (base: string, ext: string) =>
    exportFolder ? `${exportFolder}/${base}.${ext}` : `${base}.${ext}`

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Frame load error"))
      img.src = src
    })

  const releaseImage = (img: HTMLImageElement) => {
    img.onload = null
    img.onerror = null
    img.src = ""
  }

  const imageSize = async (src: string) => {
    const img = await loadImage(src)
    const size = { w: img.naturalWidth, h: img.naturalHeight }
    releaseImage(img)
    return size
  }

  const stitch = async (dataUrls: string[]) => {
    // Decode sequentially. Promise.all keeps every full-resolution bitmap in
    // memory at once and can exhaust the renderer on long captures.
    const dimensions: { w: number; h: number }[] = []
    for (const src of dataUrls) dimensions.push(await imageSize(src))

    const width = Math.max(...dimensions.map((i) => i.w))
    const height = dimensions.reduce((s, i) => s + i.h, 0)
    validateCanvasSize(width, height)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas is unavailable")
    let y = 0
    try {
      for (let i = 0; i < dataUrls.length; i++) {
        const img = await loadImage(dataUrls[i])
        try {
          ctx.drawImage(img, 0, y)
          y += img.naturalHeight
        } finally {
          releaseImage(img)
        }
        if (mountedRef.current) {
          setProgress(Math.round(((i + 1) / dataUrls.length) * 100))
        }
      }
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNG create error"))),
          "image/png"
        )
      })
    } finally {
      // Resetting dimensions releases the potentially very large backing
      // store immediately instead of waiting for a later garbage collection.
      canvas.width = 1
      canvas.height = 1
    }
  }

  const downloadPng = async () => {
    if (!tiles.length) return
    chrome.storage.local.set({
      exportFolder,
      pngFormat: whole ? "whole" : "tiles",
    })
    setStatus("Saving PNG…")
    try {
      if (whole) {
        const blob = await stitch(tiles)
        await downloadBlob(blob, fullName(fileBase(), "png"))
      } else {
        tiles.forEach((dataUrl, i) => {
          chrome.downloads.download({
            url: dataUrl,
            filename: fullName(`${fileBase()}_${i + 1}`, "png"),
            saveAs: false,
          })
        })
      }
      setStatus("PNG download started")
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const downloadPdf = async () => {
    if (!tiles.length) return
    setStatus("Building PDF…")
    try {
      const specs: { dataUrl: string; w: number; h: number }[] = []
      for (const dataUrl of tiles) {
        specs.push({ dataUrl, ...(await imageSize(dataUrl)) })
      }
      const width = Math.max(...specs.map((s) => s.w))
      const totalHeight = specs.reduce((sum, s) => sum + s.h, 0)
      const doc = new jsPDF({
        unit: "px",
        format: [width, totalHeight],
        hotfixes: ["px_scaling"],
      })
      let y = 0
      specs.forEach(({ dataUrl, w, h }) => {
        doc.addImage(dataUrl, "PNG", 0, y, w, h, undefined, "FAST")
        y += h
      })
      const blob = doc.output("blob")
      await downloadBlob(blob, fullName(fileBase(), "pdf"))
      setStatus("PDF saved")
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl bg-background px-8 py-10 text-foreground">
      <h1 className="text-lg font-medium tracking-tight">Page screenshots</h1>
      <p className="mt-1 text-xs tracking-wider text-muted-foreground uppercase">
        {error || status}
      </p>
      {error ? (
        <p className="mt-6 text-destructive">{error}</p>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {tiles.map((src, i) => (
            <figure
              key={i}
              className="overflow-hidden rounded-xl bg-card"
            >
              <img
                src={src}
                alt={`Frame ${i + 1}`}
                className="block w-full"
                loading="lazy"
                decoding="async"
              />
              <figcaption className="p-2 text-[11px] tracking-wider text-muted-foreground uppercase">
                Frame {i + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {tiles.length > 0 ? (
        <div className="mt-8 max-w-xl space-y-4 rounded-2xl bg-card p-6">
          <div>
            <Label>Downloads subfolder</Label>
            <Input
              className="mt-2"
              value={exportFolder}
              onChange={(e) => setExportFolder(e.target.value)}
              placeholder="Subfolder in Downloads"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={whole}
              onChange={() => setWhole(true)}
            />
            One whole PNG
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!whole}
              onChange={() => setWhole(false)}
            />
            Multiple frames
          </label>
          <div className="flex gap-2">
            <Button onClick={() => void downloadPng()}>Download PNG</Button>
            <Button variant="outline" onClick={() => void downloadPdf()}>
              Download PDF
            </Button>
          </div>
          {progress > 0 && progress < 100 ? (
            <Progress value={progress} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
