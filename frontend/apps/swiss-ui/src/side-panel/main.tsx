import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import "@workspace/ui/globals.css"
import { SidePanelApp } from "./App"
import { applyDocumentTheme, installDevChromeMock } from "@/lib/chrome"

installDevChromeMock()
applyDocumentTheme("light")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <SidePanelApp />
    </TooltipProvider>
  </StrictMode>
)
