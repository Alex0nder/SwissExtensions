import type { ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import { NavArrowLeft } from "iconoir-react"

export function PanelHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-2 px-4 py-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-ml-2 size-11 rounded-xl text-muted-foreground hover:text-foreground"
        onClick={onBack}
        aria-label="Back to tools"
      >
        <NavArrowLeft className="size-5" />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-[15px] leading-tight font-semibold tracking-[-0.02em]">
        {title}
      </h1>
    </header>
  )
}

export function Row({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <label className="text-xs leading-snug text-foreground">{label}</label>
      <div className="min-w-0 shrink-0">{children}</div>
    </div>
  )
}

export function StatusLine({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
      {children}
    </p>
  )
}
