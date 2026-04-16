import { getLlama, LlamaChatSession } from "node-llama-cpp";
import readline from "node:readline";

const llama = await getLlama();

const model = await llama.loadModel({
  modelPath: "C:/Users/prith/.lmstudio/models/lmstudio-community/SmolLM3-3B-GGUF/SmolLM3-3B-Q4_K_M.gguf",
  gpuLayers: 35
});

const context = await model.createContext({contextSize : 1024*16});

const session = new LlamaChatSession({
  contextSequence: context.getSequence()
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("🤖 Chatbot ready. Type 'exit' to quit.\n");

function ask() {
  rl.question("You: ", async (input) => {
    if (input === "exit") {
      rl.close();
      process.exit(0);
    }

    process.stdout.write("\nAI: ");

    await session.prompt(input, {
      onTextChunk(text) {
        process.stdout.write(text);
      }
    });

    console.log("\n");
    ask();
  });
}

ask();