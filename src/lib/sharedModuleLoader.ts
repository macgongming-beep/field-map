// Preloading and React.lazy share one import, without retaining a failed attempt.
export function createSharedModuleLoader<T>(importModule: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    if (!pending) {
      pending = importModule().catch(error => {
        pending = undefined
        throw error
      })
    }
    return pending
  }
}
