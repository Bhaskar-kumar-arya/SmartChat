import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pipeline } from '@xenova/transformers';

const SUMMARIES_PATH = path.resolve(process.cwd(), 'bhaskara_summaries.json');
const VECTORS_CACHE_PATH = path.resolve(process.cwd(), 'bhaskara_vectors.json');
const MODEL_NAME = 'bhasha-embed-onnx-quantized';
const LOCAL_MODEL_PATH = path.resolve(process.cwd(), 'src/main/models');

/**
 * Interface for the stored vector data
 */
interface SummaryVector {
  chunkId: number;
  topic: string;
  summary: string;
  vector: number[];
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }
  mA = Math.sqrt(mA);
  mB = Math.sqrt(mB);
  return dotProduct / (mA * mB);
}

async function main() {
  console.log("🚀 Starting Vector Search Script...");

  if (!fs.existsSync(SUMMARIES_PATH)) {
    console.error("❌ Summaries file not found! Please run testChatSummary.ts first.");
    return;
  }

  // 1. Initialize Embedding Pipeline
  console.log("📥 Loading Embedding Model...");
  const extractor = await pipeline('feature-extraction', MODEL_NAME, {
    local_files_only: true, // Use the local model we found
    cache_dir: LOCAL_MODEL_PATH,
    quantized: true,
  });

  // 2. Load or Generate Vectors
  let summaryVectors: SummaryVector[] = [];

  if (fs.existsSync(VECTORS_CACHE_PATH)) {
    console.log("📄 Loading vectors from cache...");
    summaryVectors = JSON.parse(fs.readFileSync(VECTORS_CACHE_PATH, 'utf8'));
    console.log(`✅ Loaded ${summaryVectors.length} vectors from cache.`);
  } else {
    console.log("🧪 Generating embeddings for all summaries (this might take a minute)...");
    const summariesData = JSON.parse(fs.readFileSync(SUMMARIES_PATH, 'utf8'));
    
    for (const chunk of summariesData) {
      process.stdout.write(`⏳ Chunk ${chunk.chunkId}... `);
      for (const item of chunk.data) {
         // We embed the combination of topic and summary for better context
         const textToEmbed = `${item.topic}: ${item.summary}`;
         const output = await extractor(textToEmbed, { pooling: 'mean', normalize: true });
         const vector = Array.from(output.data as Float32Array);
         
         summaryVectors.push({
           chunkId: chunk.chunkId,
           topic: item.topic,
           summary: item.summary,
           vector: vector
         });
      }
      process.stdout.write(`✅\n`);
    }

    console.log(`💾 Saving ${summaryVectors.length} vectors to cache...`);
    fs.writeFileSync(VECTORS_CACHE_PATH, JSON.stringify(summaryVectors), 'utf8');
  }

  // 3. Interactive Search Loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("\n--- SEMANTIC SEARCH READY ---");
  console.log("Enter a topic or question to search for relevant conversations (Type 'exit' to quit).");

  const askQuery = () => {
    rl.question("\n🔍 Search query: ", async (query) => {
      if (query.toLowerCase() === 'exit') {
        process.exit(0);
      }

      if (!query.trim()) {
        askQuery();
        return;
      }

      console.log("⚙️ Embedding query...");
      const queryOutput = await extractor(query, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(queryOutput.data as Float32Array);

      console.log("📊 Calculating similarities...");
      const results = summaryVectors.map(sv => ({
        ...sv,
        similarity: cosineSimilarity(queryVector, sv.vector)
      }));

      // Sort by similarity descending and take top 5
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, 5);

      console.log("\n✅ TOP RELEVANT SUMMARIES:");
      topResults.forEach((res, i) => {
        console.log(`\n[${i + 1}] Similarity: ${(res.similarity * 100).toFixed(2)}% | Chunk ID: ${res.chunkId}`);
        console.log(`📌 Topic: ${res.topic}`);
        console.log(`📝 Summary: ${res.summary}`);
      });

      askQuery();
    });
  };

  askQuery();
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
