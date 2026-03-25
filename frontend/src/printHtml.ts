export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Shared CSS for 80mm thermal receipt printers (iframe print). */
const RECEIPT_PRINT_CSS = `
  @page { size: 80mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-monospace, 'Cascadia Mono', 'Consolas', 'Courier New', monospace;
    font-size: 9pt;
    line-height: 1.35;
    color: #000;
    background: #fff;
    max-width: 72mm;
    margin: 0 auto;
    padding: 3mm 2mm 6mm;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .receipt-title {
    text-align: center;
    font-weight: 700;
    font-size: 11pt;
    margin: 0 0 2px;
    letter-spacing: -0.02em;
  }
  .receipt-sub {
    text-align: center;
    font-size: 8pt;
    margin: 0 0 6px;
    opacity: 0.9;
  }
  .receipt-dash {
    border: none;
    border-top: 1px dashed #000;
    margin: 5px 0;
  }
  .receipt-section {
    font-weight: 700;
    font-size: 8.5pt;
    text-align: center;
    margin: 7px 0 4px;
    letter-spacing: 0.04em;
  }
  .receipt-block { margin: 5px 0; }
  .receipt-line {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 4px;
    font-size: 9pt;
    margin: 2px 0;
  }
  .receipt-line > span:first-child {
    flex-shrink: 0;
    max-width: 48%;
    opacity: 0.92;
  }
  .receipt-line > span:last-child {
    text-align: right;
    word-break: break-word;
  }
  .receipt-text {
    font-size: 9pt;
    margin: 3px 0;
    white-space: pre-wrap;
  }
  .receipt-item-name {
    font-size: 9pt;
    font-weight: 600;
    margin: 4px 0 2px;
  }
  .receipt-muted { font-size: 8pt; opacity: 0.85; }
  @media print {
    body { padding: 2mm 1.5mm 4mm; }
  }
`

/**
 * Prints minimal HTML sized for 80mm thermal receipt rolls.
 * Caller supplies trusted app-generated markup; use `.receipt-*` classes.
 */
export function printHtmlDocument(title: string, bodyContent: string): void {
  const safeTitle = escapeHtml(title)
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>${RECEIPT_PRINT_CSS}</style></head><body><div class="receipt-root">${bodyContent}</div></body></html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  if (!win || !doc) {
    document.body.removeChild(iframe)
    return
  }

  doc.open()
  doc.write(html)
  doc.close()

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    try {
      iframe.remove()
    } catch {
      /* ignore */
    }
  }

  const fallbackRemove = window.setTimeout(cleanup, 60_000)
  win.addEventListener(
    'afterprint',
    () => {
      window.clearTimeout(fallbackRemove)
      cleanup()
    },
    { once: true },
  )
  win.focus()
  window.setTimeout(() => {
    win.print()
  }, 200)
}
