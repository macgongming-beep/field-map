export function returnDetailRetentionEnabled(
  flag = import.meta.env.VITE_RETURN_DETAIL_RETENTION_ENABLED,
  demo = import.meta.env.VITE_DEMO_MODE,
): boolean {
  return (flag ?? demo) === 'true'
}
