import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import "@workspace/ui/globals.css"
import { SuspendedApp } from "./App"
import {
  applyDocumentTheme,
  getCachedUiTheme,
  installDevChromeMock,
} from "@/lib/chrome"

installDevChromeMock()
applyDocumentTheme(getCachedUiTheme())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <SuspendedApp />
    </TooltipProvider>
  </StrictMode>
)
