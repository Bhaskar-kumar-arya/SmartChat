export interface APIConfig {
  port: number
  token: string
}

export interface IAPIConfigProvider {
  loadOrCreateConfig(): APIConfig
}
