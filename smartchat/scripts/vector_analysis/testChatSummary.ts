import { execSync } from 'child_process';
import { LMStudioClient } from '@lmstudio/sdk';
import path from 'path';
import fs from 'fs';

// Plain JSON schema for structured response
const conversationSchema = {
  type: "object",
  properties: {
    conversations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The main topic being discussed" },
          summary: { type: "string", description: "A brief summary of what was discussed under this topic" }
        },
        required: ["topic", "summary"]
      }
    }
  },
  required: ["conversations"]
};

/**
 * Executes a SQL query using the sqlite3 CLI and returns parsed JSON results.
 */
function runSql(dbPath: string, sql: string): any[] {
  try {
    const output = execSync(`sqlite3 -json "${dbPath}" "${sql}"`, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 15 });
    if (!output.trim()) return [];
    return JSON.parse(output);
  } catch (err: any) {
    // Basic fallback if -json is not supported or errors
    try {
      const output = execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: 'utf8' });
      return output.split('\n').filter(l => l.trim()).map(line => ({ value: line }));
    } catch (innerErr) {
      return [];
    }
  }
}

async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
  const outputPath = path.resolve(process.cwd(), 'bhaskara_summaries.json');
  console.log(`📂 Database path: ${dbPath}`);

  console.log("🔍 Searching for 'Bhaskara Brothers' chat...");

  // Search both Chat and Contact tables for a robust match
  const chatSearchSql = `SELECT id as jid, COALESCE(name, notify) as name FROM Contact WHERE name LIKE '%Study group%' OR notify LIKE '%Study group%' UNION SELECT jid, name FROM Chat WHERE name LIKE '%Study group%' LIMIT 1;`;
  const chats = runSql(dbPath, chatSearchSql);

  if (chats.length === 0) {
    console.error("❌ Chat 'Bhaskara Brothers' not found in database!");
    return;
  }

  const chat = chats[0];
  console.log(`✅ Found chat: ${chat.name} (JID: ${chat.jid})`);

  console.log("📨 Fetching top 2000 messages...");
  const messagesSql = `SELECT participant, remoteJid, fromMe, timestamp, textContent FROM Message WHERE remoteJid = '${chat.jid}' AND textContent IS NOT NULL AND isDeleted = 0 AND messageType != 'reactionMessage' ORDER BY timestamp DESC LIMIT 2000;`;
  const messages = runSql(dbPath, messagesSql);

  if (messages.length === 0) {
    console.log("⚠️ No messages found in this chat.");
    return;
  }

  messages.reverse(); // Chronological order
  console.log(`📊 Total messages to process: ${messages.length}`);

  console.log("👥 Refreshing names mapping...");
  const contactRows = runSql(dbPath, "SELECT id, name, notify FROM Contact;");
  const contactMap = new Map();
  for (const c of contactRows) {
    contactMap.set(c.id, c.name || c.notify || c.id.split('@')[0]);
  }

  const formattedMessages: string[] = [];
  for (const msg of messages) {
    const senderId = msg.participant || msg.remoteJid;
    const sender = msg.fromMe === 1 ? 'Me' : (contactMap.get(senderId) || (senderId || '').split('@')[0] || 'Unknown');

    const ts = Number(msg.timestamp) * 1000;
    const date = new Date(isNaN(ts) ? Date.now() : ts);
    const dateString = date.toLocaleString();

    formattedMessages.push(`[${dateString}] ${sender}: ${msg.textContent}`);
  }

  // Chunking: approximately 500 tokens (approx 2000 characters)
  const chunks: string[] = [];
  let currentChunk = "";
  const charsPerChunk = 2000;

  for (const msg of formattedMessages) {
    if ((currentChunk.length + msg.length) > charsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += msg + "\n";
  }
  if (currentChunk.trim().length > 0) chunks.push(currentChunk);

  console.log(`📦 Divided into ${chunks.length} chunks.`);

  console.log("🤖 Initializing LM Studio Client (smollm3)...");
  try {
    const client = new LMStudioClient();
    const model = await client.llm.load("lmstudio-community/smollm3-3b", {
      config: { contextLength: 8192 }, // Ample context
      ttl: 60
    });

    console.log("\n--- STARTING CONVERSATION ANALYSIS ---");
    const allSummaries: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      process.stdout.write(`⏳ Chunk ${i + 1}/${chunks.length}... `);

      const prompt = `You are a conversation analyst. Here is a segment of a WhatsApp group chat. Summarize the discussions happening here, grouping them into logical topics. Use a professional and concise tone.\n\nCONVERSATION LOGS:\n${chunks[i]}`;

      try {
        const result = await model.respond(prompt, {
          structured: {
            type: "json",
            jsonSchema: conversationSchema
          },
          maxTokens: 3000,
          temperature: 0.1
        });

        const parsed = JSON.parse(result.content);

        allSummaries.push({
          chunkId: i + 1,
          timestamp: new Date().toISOString(),
          data: parsed.conversations
        });
        process.stdout.write(`✅ Done (${parsed.conversations.length} topics)\n`);
      } catch (chunkErr: any) {
        console.error(`\n❌ Error on chunk ${i + 1}:`, chunkErr.message);
      }
    }

    console.log(`\n💾 Saving results to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(allSummaries, null, 2), 'utf8');

    console.log("\n✨ Process completed successfully!");
    const totalTopics = allSummaries.reduce((acc, s) => acc + s.data.length, 0);
    console.log(`📊 Statistics: ${chunks.length} chunks analyzed, ${totalTopics} topics extracted.`);

    await model.unload();
  } catch (err: any) {
    console.error("\n❌ LM Studio Connection Error:", err.message);
    console.log("Please ensure LM Studio is running and the model is loaded.");
  }

  process.exit(0);
}

main().catch(err => {
  console.error("\n💥 Fatal error:", err);
  process.exit(1);
});
