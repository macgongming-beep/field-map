export function isReturnVisitDetailPath(path: string): boolean {
  const match = /^\/territory\/regular\/([1-9]\d*)\/?$/.exec(path)
  return match !== null && Number.isSafeInteger(Number(match[1]))
}
