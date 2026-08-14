(() => {
  const fallbackUrl = new URL("./suspended-fallback.svg", window.location.href).toString()
  const link =
    document.querySelector('link[rel~="icon"]') ?? document.createElement("link")
  link.rel = "icon"
  if (!link.isConnected) document.head.append(link)

  try {
    const params = new URLSearchParams(window.location.search)
    const pageUrl = params.get("u") || params.get("o") || ""
    if (!/^https?:\/\//i.test(pageUrl)) {
      link.type = "image/svg+xml"
      link.href = fallbackUrl
      return
    }

    const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"))
    faviconUrl.searchParams.set("pageUrl", pageUrl)
    faviconUrl.searchParams.set("size", "32")

    link.rel = "icon"
    link.type = "image/png"
    link.href = faviconUrl.toString()

    // Turn Chrome's favicon endpoint into a self-contained icon before a
    // background placeholder is discarded. The direct URL remains an
    // immediate first paint while the image is being resolved.
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = 32
        canvas.height = 32
        canvas.getContext("2d")?.drawImage(image, 0, 0, 32, 32)
        link.href = canvas.toDataURL("image/png")
      } catch {
        link.href = faviconUrl.toString()
      }
    }
    image.onerror = () => {
      link.type = "image/svg+xml"
      link.href = fallbackUrl
    }
    image.src = faviconUrl.toString()
  } catch {
    link.type = "image/svg+xml"
    link.href = fallbackUrl
  }
})()
