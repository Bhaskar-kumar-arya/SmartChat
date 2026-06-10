export interface INotificationProvider {
  name: string
  isSupported(): boolean
  send(
    title: string,
    body: string,
    options?: { silent?: boolean; icon?: string | any },
    onClick?: () => void
  ): void
}
