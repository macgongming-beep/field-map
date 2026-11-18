export function getStartupShell(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('app-startup')
}

export function dismissStartupShell(): void {
  getStartupShell()?.remove()
}
