// scripts/countTokens.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Local approximation heuristic:
 * - Average token is ~4 characters in English
 * - We also account for the 'overhead' of sending messages to AI 
 *   (Names, Timestamps, and structure tags)
 */
function approximateTokens(text: string): number {
  if (!text) return 0
  // Standard heuristic: characters / 4
  return Math.ceil(text.length / 4)
}

async function run() {
  console.log('📊 Calculating local token approximation...')
  
  const messages = await prisma.message.findMany({
    where: {
      textContent: { not: null, not: "" }
    },
    select: { 
      textContent: true,
      timestamp: true,
      fromMe: true,
      participant: true
    }
  })

  if (messages.length === 0) {
    console.log('❌ No messages found in the database.')
    return
  }

  let rawContentTokens = 0
  let aiOverheadTokens = 0 // Accounting for Names/Timestamps added by AIService

  messages.forEach(m => {
    // 1. Raw Message Tokens
    rawContentTokens += approximateTokens(m.textContent!)

    // 2. AI Overhead (Format: [Timestamp] Name: ...)
    // Approximate overhead: ~15 tokens per message header
    aiOverheadTokens += 15 
  })

  const totalApprox = rawContentTokens + aiOverheadTokens

  console.log('\n--- 📈 Results (Local Approximation) ---')
  console.log(`Total Messages:       ${messages.length.toLocaleString()}`)
  console.log(`Raw Content Tokens:   ~${rawContentTokens.toLocaleString()}`)
  console.log(`AI Prompt Overhead:   ~${aiOverheadTokens.toLocaleString()}`)
  console.log(`---------------------------------------`)
  console.log(`Total Estimated:      ~${totalApprox.toLocaleString()} tokens`)
  console.log(`---------------------------------------`)
  console.log(`\n💡 Note: This is an offline estimate (1 token ≈ 4 chars).`)
  console.log(`Actual API counts may vary by ±10-15%.`)
  
  await prisma.$disconnect()
}

run().catch(console.error)
