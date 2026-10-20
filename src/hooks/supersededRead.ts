// Expected cancellation: a newer read owns the snapshot now.
export class SupersededReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupersededReadError'
  }
}

export async function readSnapshotParts<T>(reads: Promise<T>[]): Promise<T[]> {
  try {
    return await Promise.all(reads)
  } catch (error) {
    if (!(error instanceof SupersededReadError)) throw error
    // A cancelled part must not hide a real failure in another snapshot part.
    const results = await Promise.allSettled(reads)
    for (const result of results) {
      if (result.status === 'rejected' && !(result.reason instanceof SupersededReadError)) {
        throw result.reason
      }
    }
    throw error
  }
}
