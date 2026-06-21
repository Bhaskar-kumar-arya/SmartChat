export interface MessageQueryFilter {
  chatJid?: string
  chatJids?: string[]
  fromDate?: bigint
  toDate?: bigint
  fromMe?: boolean
  textContentContains?: string
}
