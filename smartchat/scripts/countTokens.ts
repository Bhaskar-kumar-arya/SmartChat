import { execSync } from 'child_process'
import { AutoTokenizer } from '@xenova/transformers'
import path from 'path'

async function countTokensFromCli() {
  console.log('🔄 Loading tokenizer (Gemma/GPT-4 equivalent via @xenova/transformers)...')
  
  // Using a common tokenizer for estimation
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/gpt-4')

  const dbPath = path.resolve('..', 'prisma', 'dev.db')
  console.log(`📂 Reading database from: ${dbPath}...`)

  try {
    // Get total text size first for a progress estimate if needed, 
    // but message-by-message counting is safer for memory.
    // We use a temporary file to dump the text to avoid shell buffer limits.
    const sql = "SELECT textContent FROM Message WHERE textContent IS NOT NULL;"
    const output = execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 }) // 50MB buffer

    const messages = output.split('\n').filter(line => line.trim().length > 0)
    
    console.log(`📊 Processing ${messages.length} lines of text...`)

    let totalTokens = 0
    let totalChars = 0

    for (const msg of messages) {
      const tokens = tokenizer.encode(msg)
      totalTokens += tokens.length
      totalChars += msg.length
    }

    console.log('\n✅ Calculation Complete!')
    console.log('--- TOKEN ESTIMATES ---')
    console.log(`Total Messages: ${messages.length}`)
    console.log(`Total Characters: ${totalChars}`)
    console.log(`Estimated Tokens: ${totalTokens}`)
    console.log(`Avg Tokens/Msg:   ${(totalTokens / messages.length).toFixed(1)}`)
    console.log('------------------------\n')

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ Error: `sqlite3` command not found. Please install it or use the native driver.')
    } else {
      console.error('❌ Error executing SQLite query:', error.message)
    }
  }
}

countTokensFromCli().catch(err => {
  console.error('Fatal error:', err)
})
