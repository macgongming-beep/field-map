export function privateUserReadsEnabled(
  flag = import.meta.env.VITE_PRIVATE_USER_READS_ENABLED,
  demo = import.meta.env.VITE_DEMO_MODE,
): boolean {
  return (flag ?? demo) === 'true'
}
