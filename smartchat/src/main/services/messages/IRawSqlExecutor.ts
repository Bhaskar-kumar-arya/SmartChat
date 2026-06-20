export interface IRawSqlExecutor {
  queryMessageIdsBySql(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}
