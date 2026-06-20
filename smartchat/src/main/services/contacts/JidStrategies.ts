import { IJidStrategy } from './IJidStrategy'

export class PnJidStrategy implements IJidStrategy {
  supports(jid: string): boolean {
    return jid.endsWith('@s.whatsapp.net')
  }
  aliasType = 'PN'
}

export class LidJidStrategy implements IJidStrategy {
  supports(jid: string): boolean {
    return jid.endsWith('@lid')
  }
  aliasType = 'LID'
}

export class GroupJidStrategy implements IJidStrategy {
  supports(jid: string): boolean {
    return jid.endsWith('@g.us')
  }
  aliasType = 'GROUP'
}

export class BotJidStrategy implements IJidStrategy {
  supports(jid: string): boolean {
    return jid.endsWith('@bot')
  }
  aliasType = 'BOT'
}
