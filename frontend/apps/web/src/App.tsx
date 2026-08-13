import {
  ArrowUpRight,
  Building,
  Camera,
  Cpu,
  Download,
  Github,
  Globe,
  NavArrowRight,
  Shield,
  Trash,
  WindowTabs,
  X,
} from "iconoir-react"

import creatorPortrait from "./assets/creator-portrait.jpg"

const SWISS_VERSION = "1.5.48"
const STORE_URL =
  "https://chromewebstore.google.com/detail/obemilbkkamjohnlhlbmcmnoifojhjip?utm_source=item-share-cb"
const GITHUB_URL = "https://github.com/Alex0nder/SwissExtensions"
const PRIVACY_URL =
  "https://github.com/Alex0nder/SwissExtensions/blob/main/PRIVACY_POLICY.md"

const contactLinks = [
  {
    label: "GitHub · Alex0nder",
    href: "https://github.com/Alex0nder",
    icon: Github,
  },
  {
    label: "GitHub · Navorina Labs",
    href: "https://github.com/navorina-labs",
    icon: Building,
  },
  {
    label: "alexyoung33rd.com",
    href: "https://alexyoung33rd.com/",
    icon: Globe,
  },
  {
    label: "X · @Alex0nder",
    href: "https://x.com/Alex0nder",
    icon: X,
  },
]

const downloads = [
  {
    name: "Page Capture",
    description: "Save a full page as PNG or PDF.",
    preview: "Save as PNG or PDF",
    icon: Camera,
    version: "1.0.3",
    file: "PdfExtensions-v1.0.3.zip",
  },
  {
    name: "Tab Hibernate",
    description: "Put unused tabs to sleep.",
    preview: "Sleep inactive tabs",
    icon: WindowTabs,
    version: "1.0.3",
    file: "TabHibernate-v1.0.3.zip",
  },
  {
    name: "Memory Cleaner",
    description: "Free memory from background tabs.",
    preview: "Free background RAM",
    icon: Cpu,
    version: "1.0.3",
    file: "TabMemoryCleaner-v1.0.3.zip",
  },
  {
    name: "Site Blocker",
    description: "Block distracting websites.",
    preview: "Block distracting sites",
    icon: Shield,
    version: "1.6.1",
    file: "SiteBlocker-v1.6.1.zip",
  },
  {
    name: "Site Data Clear",
    description: "Clear cookies and storage for one site.",
    preview: "Clear cookies and storage",
    icon: Trash,
    version: "1.0.2",
    file: "SiteDataClear-v1.0.2.zip",
  },
]

function Brand() {
  return (
    <span className="brand-lockup">
      <svg
        className="brand-flag"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="32" height="32" rx="5" fill="currentColor" />
        <path d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7V6Z" fill="white" />
      </svg>
      <span>Swiss Extensions</span>
    </span>
  )
}

function ProductPreview() {
  return (
    <div
      className="product-preview"
      role="img"
      aria-label="Preview of the Swiss Extensions side panel with browser tools"
    >
      <div className="browser-bar" aria-hidden="true">
        <span className="browser-dot" />
        <span className="browser-dot" />
        <span className="browser-dot" />
        <span className="browser-address">chrome://extensions</span>
        <span className="browser-menu">•••</span>
      </div>
      <div className="browser-canvas" aria-hidden="true">
        <div className="browser-ghost">
          <span />
          <span />
          <span />
        </div>
        <div className="side-panel">
          <div className="panel-head">
            <Brand />
            <span className="panel-close">×</span>
          </div>
          <div className="panel-list">
            {downloads.map((item, index) => {
              const Icon = item.icon

              return (
                <div
                  className={`panel-row${index === downloads.length - 1 ? " panel-row-wide" : ""}`}
                  key={item.name}
                >
                  <span className="panel-icon">
                    <Icon aria-hidden="true" width={17} height={17} />
                  </span>
                  <span className="panel-copy">
                    <span className="panel-row-title">{item.name}</span>
                    <span className="panel-row-description">{item.preview}</span>
                  </span>
                  <NavArrowRight
                    className="panel-arrow"
                    aria-hidden="true"
                    width={15}
                    height={15}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function App() {
  return (
    <div className="there-page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="there-header">
        <a href="/" aria-label="Swiss Extensions home">
          <Brand />
        </a>
        <a
          className="header-link"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
          <span className="github-mark" aria-hidden="true">
            GH
          </span>
        </a>
      </header>

      <main id="main">
        <section className="there-hero" aria-labelledby="hero-title">
          <h1 id="hero-title">Useful browser tools in one side panel</h1>
          <a
            className="primary-button"
            href={STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install for Chrome
            <ArrowUpRight aria-hidden="true" width={18} height={18} />
          </a>
          <p className="hero-meta">
            Version {SWISS_VERSION} <span aria-hidden="true">|</span> Manifest V3{" "}
            <span aria-hidden="true">|</span>{" "}
            <a href={`/downloads/SwissExtensions-v${SWISS_VERSION}.zip`} download>
              Download ZIP
            </a>
          </p>
        </section>

        <ProductPreview />

        <p className="trust-line">
          Open source <span aria-hidden="true">·</span> No account{" "}
          <span aria-hidden="true">·</span> No tracking{" "}
          <span aria-hidden="true">·</span> Everything stays on your device
        </p>

        <section className="tools-section" aria-labelledby="tools-title">
          <h2 id="tools-title">Or download one tool</h2>
          <div className="tool-grid">
            {downloads.map((item) => (
              <a
                className="tool-card"
                href={`/downloads/${item.file}`}
                download
                key={item.file}
              >
                <div className="tool-copy">
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                </div>
                <span className="tool-download">
                  <span>v{item.version}</span>
                  <Download aria-hidden="true" width={17} height={17} />
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-title">
          <div className="about-portrait-wrap">
            <img
              className="about-portrait"
              src={creatorPortrait}
              alt="Portrait of the creator of Swiss Extensions"
            />
          </div>
          <div className="about-copy">
            <p className="about-eyebrow">About the project</p>
            <h2 id="about-title">Why I called it Swiss Extensions</h2>
            <p className="about-lead">
              Switzerland has always represented a rare kind of confidence to
              me: precision without noise. Trains arrive, typography stays
              clear, and well-made things do their work without asking for
              attention.
            </p>
            <p>
              That is what I wanted from a browser extension. Not another
              dashboard competing for your focus, but a growing set of small
              instruments — quiet, local, and dependable — gathered in one side
              panel.
            </p>
            <p>
              The Alps inspired the atmosphere; Swiss design inspired the
              restraint. Red marks what matters, the grid keeps everything in
              place, and every feature has to earn its space. The name is less
              about geography than a promise: useful software should feel
              considered, private, and built to last.
            </p>
            <nav className="about-links" aria-label="Creator links">
              {contactLinks.map((contact) => {
                const Icon = contact.icon

                return (
                  <a
                    className="about-link"
                    href={contact.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={contact.label}
                    title={contact.label}
                    key={contact.href}
                  >
                    <Icon aria-hidden="true" width={19} height={19} />
                  </a>
                )
              })}
            </nav>
          </div>
        </section>
      </main>

      <footer className="there-footer">
        <span>© 2026 Swiss Extensions</span>
        <span>v{SWISS_VERSION}</span>
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          Privacy
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  )
}
