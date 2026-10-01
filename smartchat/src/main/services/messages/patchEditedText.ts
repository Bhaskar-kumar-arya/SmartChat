type JsonRecord = Record<string, unknown>

/**
 * Pure: rewrites the text/caption of an outgoing message's stored content JSON
 * (used by MessageActionService.editMessage; sibling of `applyEdit` in utils/messageUtils).
 */
export function patchEditedText(contentJson: string, newText: string): string {
  const updatedContent = JSON.parse(contentJson || '{}')
  const rootContextInfo = updatedContent.contextInfo as JsonRecord | undefined

  if (updatedContent.extendedTextMessage) {
    updatedContent.extendedTextMessage.text = newText
  } else if (rootContextInfo) {
    updatedContent.extendedTextMessage = { text: newText, contextInfo: rootContextInfo }
    delete updatedContent.conversation
    delete updatedContent.contextInfo
  } else if (updatedContent.conversation !== undefined) {
    updatedContent.conversation = newText
  } else if (updatedContent.imageMessage) {
    updatedContent.imageMessage.caption = newText
  } else if (updatedContent.videoMessage) {
    updatedContent.videoMessage.caption = newText
  } else if (updatedContent.documentMessage) {
    updatedContent.documentMessage.caption = newText
  } else {
    updatedContent.conversation = newText
  }
  return JSON.stringify(updatedContent)
}
