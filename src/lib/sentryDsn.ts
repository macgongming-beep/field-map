// A browser DSN is a public URL, never a setup snippet or a private credential.
export function normalizeSentryDsn(value: string | undefined): string | undefined {
  const dsn = value?.trim()
  if (!dsn) return undefined
  try {
    const url = new URL(dsn)
    if (url.protocol !== 'https:' || !/^\w+$/.test(url.username) || url.password
      || !url.hostname || !/^\/(?:[\w-]+\/)*\d+$/.test(url.pathname)
      || url.search || url.hash || /\s/.test(dsn)) throw new Error()
    return dsn
  } catch {
    throw new Error('VITE_SENTRY_DSN must be an HTTPS public DSN URL, not setup code')
  }
}
