export interface IIdentityReconciliationService {
  deduplicateIdentities(): Promise<{ merged: number; skipped: number }>
  reconcileLidPnFromJids(
    potentialIds: (string | null | undefined)[],
    source: string
  ): Promise<void>
}
