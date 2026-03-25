/** Escape one CSV field (RFC-style). */
export function csvEscape(cell: string): string {
  const s = String(cell).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsvRow(cells: string[]): string {
  return cells.map(csvEscape).join(',')
}

/** UTF-8 BOM helps Excel open UTF-8 CSV correctly. */
export function downloadCsv(filename: string, lines: string[]): void {
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
