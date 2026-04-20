import fs from 'fs';
import path from 'path';
import { HDBSCAN } from 'hdbscan-ts';

const VECTORS_CACHE_PATH = path.resolve(process.cwd(), 'bhaskara_vectors.json');
const OUTPUT_HTML_PATH = path.resolve(process.cwd(), 'graph_rag_visualization.html');

interface SummaryVector {
  chunkId: number;
  topic: string;
  summary: string;
  vector: number[];
}

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
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (mA * mB);
}

async function main() {
  console.log("🚀 Starting Graph RAG Visualization Script...");

  if (!fs.existsSync(VECTORS_CACHE_PATH)) {
    console.error("❌ Vectors cache not found! Please run testVectorSearch.ts first.");
    return;
  }

  // 1. Load Data
  console.log("📥 Loading Vectors...");
  const summaryVectors: SummaryVector[] = JSON.parse(fs.readFileSync(VECTORS_CACHE_PATH, 'utf8'));
  console.log(`✅ Loaded ${summaryVectors.length} vectors.`);

  if (summaryVectors.length === 0) {
    console.error("No vectors to connect.");
    return;
  }

  const vectors = summaryVectors.map(sv => sv.vector);

  // 2. Identify Communities (Semantics) using HDBSCAN
  console.log("🧩 Identifying Semantic Communities with HDBSCAN...");
  const hdbscan = new HDBSCAN({
    minClusterSize: 3,
    minSamples: 2,
  });
  hdbscan.fit(vectors);
  const clusters = hdbscan.labels_;

  // 3. Build Semantic k-NN Graph Structure
  console.log("🕸 Build K-Nearest Neighbors Graph (Graph RAG)...");
  const nodes = summaryVectors.map((sv, i) => ({
    id: i.toString(),
    topic: sv.topic,
    summary: sv.summary,
    chunkId: sv.chunkId,
    group: clusters[i], // For community coloring
    val: 5 // Node size visual representation
  }));

  const edges: { source: string; target: string; similarity: number }[] = [];
  const K_NEIGHBORS = 4; // Top 4 closest semantic matches for each memory node
  const SIMILARITY_THRESHOLD = 0.65; // Avoid connecting completely unrelated things

  for (let i = 0; i < summaryVectors.length; i++) {
    const similarities = [];
    for (let j = 0; j < summaryVectors.length; j++) {
      if (i === j) continue;
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      similarities.push({ index: j, similarity: sim });
    }

    // Sort by similarity descending
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Pick top K
    let matchesAdded = 0;
    for (const match of similarities) {
      if (matchesAdded >= K_NEIGHBORS) break;
      if (match.similarity >= SIMILARITY_THRESHOLD) {
        // Only append edge if we haven't already mapped this relationship bilaterally (saves memory) // wait, undirected graph, so standardizing edge representations or letting layout handle bidirectional naturally mapping helps. 
        // We'll just define directed for layout and layout will manage them as undirected naturally.
        edges.push({
          source: i.toString(),
          target: match.index.toString(),
          similarity: match.similarity
        });
        matchesAdded++;
      }
    }
  }

  // Deduplicate undirected edges
  const uniqueEdgesMap = new Set();
  const finalEdges = [];
  for (const e of edges) {
    const canonical = Number(e.source) < Number(e.target) 
      ? `${e.source}-${e.target}` 
      : `${e.target}-${e.source}`;
      
    if (!uniqueEdgesMap.has(canonical)) {
      uniqueEdgesMap.add(canonical);
      finalEdges.push(e);
    }
  }

  console.log(`✅ Constructed Graph with ${nodes.length} nodes and ${finalEdges.length} semantic edges.`);

  // 4. Generate Interactive Visualization using force-graph
  console.log("🖼 Generating HTML Graph Visualisation...");
  const graphData = { nodes, links: finalEdges };

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Graph RAG Memory Network</title>
  <script src="https://unpkg.com/force-graph"></script>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #111; color: #fff; overflow: hidden; }
    #header { position: absolute; top: 0; left: 0; padding: 15px 30px; background: rgba(20,20,20,0.8); border-bottom: 1px solid rgba(255,255,255,0.1); width: 100vw; z-index: 10; pointer-events: none; }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 500; color: #e0e0e0; }
    p { margin: 5px 0 0; color: #999; font-size: 0.9rem; }
    #graph { width: 100vw; height: 100vh; }
    
    .node-tooltip { background: rgba(0, 0, 0, 0.9); padding: 12px; border-radius: 6px; border: 1px solid #444; max-width: 350px; font-size: 0.85rem; box-shadow: 0 4px 15px rgba(0,0,0,0.5); pointer-events: none; }
    .node-topic { display: block; font-weight: bold; color: #6db6ff; font-size: 1rem; margin-bottom: 5px; }
    .node-summary { display: block; color: #ddd; line-height: 1.4; word-wrap: break-word; }
    .node-meta { display: block; margin-top: 8px; color: #888; font-size: 0.75rem; }
  </style>
</head>
<body>
  <div id="header">
    <h1>Graph RAG Memory Network</h1>
    <p>Displays embedded node representations organized as a semantic k-NN graph. Connections represent close vector distances.</p>
  </div>
  <div id="graph"></div>

  <script>
    const gData = ${JSON.stringify(graphData)};

    // Map communities to colors
    const noiseColor = '#444444';
    const numColors = [
      '#FF5E5B', '#D8D27B', '#00CECB', '#FFED66', '#FF9F1C', 
      '#2EC4B6', '#E71D36', '#87A330', '#A5243D', '#544EE6',
      '#FF00FF', '#00FF00', '#00FFFF', '#FFFF00', '#FFA500'
    ];

    const Graph = ForceGraph()(document.getElementById('graph'))
      .graphData(gData)
      .nodeId('id')
      .nodeVal('val')
      .nodeColor(node => node.group === -1 ? noiseColor : numColors[node.group % numColors.length])
      .linkColor(() => 'rgba(255,255,255,0.15)')
      .linkWidth(link => Math.max(0.2, (link.similarity - 0.6) * 5)) // Visually scale width by similarity
      .nodeLabel(node => {
        return \`<div class="node-tooltip">
          <span class="node-topic">\${node.topic}</span>
          <span class="node-summary">\${node.summary}</span>
          <span class="node-meta">Chunk: \${node.chunkId} | Community: \${node.group === -1 ? 'Noise' : node.group}</span>
        </div>\`;
      })
      .onNodeDragEnd(node => {
        node.fx = node.x;
        node.fy = node.y;
      })
      // Custom node rendering to show text directly on the canvas without hovering
      .nodeCanvasObject((node, ctx, globalScale) => {
        const label = node.topic;
        const fontSize = 12/globalScale;
        ctx.font = \`\${fontSize}px Sans-Serif\`;
        const textWidth = ctx.measureText(label).width;
        const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); 

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        // ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, ...bckgDimensions);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw Dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI, false);
        ctx.fillStyle = node.group === -1 ? noiseColor : numColors[node.group % numColors.length];
        ctx.fill();

        // Draw Text
        ctx.fillStyle = node.group === -1 ? '#888' : '#fff';
        // Hide labels if we are zoomed out too much
        if (globalScale > 0.8) {
           ctx.fillText(label, node.x, node.y + 8);
        }
      });

    // Make the physics a bit more expansive for memory graphs
    Graph.d3Force('charge').strength(-150);
  </script>
</body>
</html>`;

  fs.writeFileSync(OUTPUT_HTML_PATH, htmlContent, 'utf8');
  console.log(`✅ Visualisation saved to: ${OUTPUT_HTML_PATH}`);
  console.log("🌐 Open this file in your browser to explore the Memory Graph.");
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
