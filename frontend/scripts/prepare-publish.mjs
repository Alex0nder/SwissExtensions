#!/usr/bin/env node
/**
 * After Vite build: copy favicon/ and downloads/ into apps/web/dist for Netlify.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
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
