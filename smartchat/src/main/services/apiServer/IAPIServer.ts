export interface IAPIServer {
  start(): void
  stop(): Promise<void>
  getApiToken(): string
  getPort(): number
}
