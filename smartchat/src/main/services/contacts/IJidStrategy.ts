export interface IJidStrategy {
  supports(jid: string): boolean
  aliasType: string
}
