import { cleanJid } from './jidUtils'
import { ChatUpdatePayload } from '../domain/whatsapp.types'

/**
 * Standardizes community information parsed from a chat update/group metadata payload.
 */
export function parseCommunityMetadata(jid: string, update: ChatUpdatePayload): {
  hasCommunityData: boolean
  isCommunity: boolean
  isAnnounce: boolean
  parentGroupJid: string | null
  type: 'COMMUNITY' | 'ANNOUNCE' | 'SUBGROUP' | 'GROUP' | 'DM'
  rootJid: string | null
} {
  const cleanedJid = cleanJid(jid)
  const hasCommunityData = update.isCommunity !== undefined || 
                           update.isParentGroup !== undefined || 
                           update.isAnnounce !== undefined || 
                           update.isCommunityAnnounce !== undefined || 
                           update.isDefaultSubgroup !== undefined || 
                           update.linkedParentJid !== undefined || 
                           update.linkedParent !== undefined || 
                           update.parentGroupId !== undefined

  const isComm = update.isCommunity === true || update.isParentGroup === true
  const isAnn = update.isAnnounce === true || update.isCommunityAnnounce === true || update.isDefaultSubgroup === true
  const parent = update.linkedParentJid || update.linkedParent || update.parentGroupId
  const parentGroupJid = parent ? cleanJid(parent) : null

  let type: 'COMMUNITY' | 'ANNOUNCE' | 'SUBGROUP' | 'GROUP' | 'DM' = 'DM'
  if (cleanedJid.endsWith('@g.us')) {
    if (isComm) type = 'COMMUNITY'
    else if (isAnn) type = 'ANNOUNCE'
    else if (parentGroupJid) type = 'SUBGROUP'
    else type = 'GROUP'
  }

  const rootJid = isComm ? cleanedJid : (parentGroupJid ? cleanJid(parentGroupJid) : null)

  return {
    hasCommunityData,
    isCommunity: isComm,
    isAnnounce: isAnn,
    parentGroupJid,
    type,
    rootJid
  }
}
