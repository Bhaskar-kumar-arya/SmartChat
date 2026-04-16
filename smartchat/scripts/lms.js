import { LMStudioClient } from "@lmstudio/sdk";
import readline from "readline";

const client = new LMStudioClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const model = await client.llm.load("lmstudio-community/smollm3-3b", { config : { contextLength : 1024*24 }, ttl : 60 });

const contextLength = await model.getContextLength();

console.log(`Context Length: ${contextLength}`);
let history = [
  { role: "system", content: "You are a helpful assistant." }
];

async function chat() {
  rl.question("You: ", async (input) => {
    history.push({ role: "user", content: input });

    // 1. Start the timer before calling respond
    const startTime = Date.now();
    const stream = model.respond(history);

    let response = "";
    process.stdout.write("AI: ");

    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        response += chunk.content;
      }
    }

    // 2. Stop the timer when the stream finishes
    const endTime = Date.now();

    // 3. Fetch the prediction stats from the stream result
    const result = await stream.result();
    const tokens = result.stats.predictedTokensCount;
    
    // 4. Calculate total duration in seconds and tokens per second
    const durationSecs = (endTime - startTime) / 1000;
    const tps = (tokens / durationSecs).toFixed(2);

    console.log(`\n\n[⚙️ Stats: ${tokens} tokens generated in ${durationSecs.toFixed(2)}s (${tps} tok/sec)]\n`);

    history.push({ role: "assistant", content: response });

    chat();
  });
}

async function shutdown() {
  console.log("\nShutting down...");
  rl.close();
  await model.unload();
  console.log("Model unloaded.");
  process.exit(0);
}

rl.on("SIGINT", shutdown);
process.on("SIGINT", shutdown);

chat();