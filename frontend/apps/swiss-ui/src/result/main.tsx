import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import "@workspace/ui/globals.css"
import { ResultApp } from "./App"
import { applyDocumentTheme } from "@/lib/chrome"

applyDocumentTheme("dark")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ResultApp />
    </TooltipProvider>
  </StrictMode>
)
