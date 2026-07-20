export interface DocSection {
  /** Short heading, e.g. "ctx.events" */
  heading: string
  /** Permission string(s) required, e.g. ["events:message:incoming"] */
  permissions: string[]
  /** Plain-text body: method signatures + descriptions */
  body: string
}

export interface IDocSource {
  getDocSection(): DocSection
}
