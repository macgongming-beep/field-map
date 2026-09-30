export function getMobileMapSelectedSheetHeight(viewportHeight: number, regularVisitScope: boolean): number {
  if (!regularVisitScope) return viewportHeight * 0.46
  return Math.round(Math.max(190, Math.min(240, viewportHeight * 0.28)))
}

export function getMobileMapSelectedPeekHeight(viewportHeight: number): number {
  // Leave room for the handle, summary, three building lines and bottom safe area.
  return Math.round(Math.max(170, Math.min(200, viewportHeight * 0.16 + 50)))
}

export function getMobileMapPinPanOffset(sheetHeight: number, topInset = 90): number {
  return Math.max(0, Math.round((sheetHeight - topInset) / 2))
}
