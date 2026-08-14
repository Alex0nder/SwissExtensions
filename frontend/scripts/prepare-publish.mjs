#!/usr/bin/env node
/**
 * After Vite build: copy favicon/ and downloads/ into apps/web/dist for Netlify.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../..")
const dist = path.resolve(__dirname, "../apps/web/dist")

if (!existsSync(dist)) {
  console.error("Missing dist. Run web build first.")
  process.exit(1)
}

const copies = [
  { from: path.join(repoRoot, "favicon"), to: path.join(dist, "favicon") },
  { from: path.join(repoRoot, "downloads"), to: path.join(dist, "downloads") },
]

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.warn(`Skip missing: ${from}`)
    continue
  }
  mkdirSync(path.dirname(to), { recursive: true })
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  console.log(`Copied ${path.basename(from)} → dist/${path.basename(to)}`)
}

cpSync(
  path.join(repoRoot, "favicon", "favicon.ico"),
  path.join(dist, "favicon.ico")
)
console.log("Copied favicon.ico → dist/favicon.ico")

// Manual Netlify deploys only receive the contents of dist, so netlify.toml at
// the repository root is not available. Keep the equivalent cache policy in
// the deploy bundle itself.
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/favicon/*
  Cache-Control: public, max-age=3600, must-revalidate

/favicon/site.webmanifest
  Cache-Control: public, max-age=0, must-revalidate

/downloads/*.zip
  Cache-Control: public, max-age=86400, immutable
`

writeFileSync(path.join(dist, "_headers"), headers)
console.log("Created dist/_headers for manual Netlify deploys")
