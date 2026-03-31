const KEY = 'clock-system.thermal-paper-width.v1'

export type ThermalPaperWidth = '58' | '80'

export function loadThermalPaperWidth(): ThermalPaperWidth {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === '80') return '80'
    return '58'
  } catch {
    return '58'
  }
}

export function saveThermalPaperWidth(value: ThermalPaperWidth): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    /* ignore */
  }
}
