import fs from 'fs';
import path from 'path';
import { UMAP } from 'umap-js';
import { HDBSCAN } from 'hdbscan-ts';

const VECTORS_CACHE_PATH = path.resolve(process.cwd(), 'bhaskara_vectors.json');
const OUTPUT_HTML_PATH = path.resolve(process.cwd(), 'clusters_visualization.html');

interface SummaryVector {
  chunkId: number;
  topic: string;
  summary: string;
  vector: number[];
}

async function main() {
  console.log("🚀 Starting Visualization Script...");

  if (!fs.existsSync(VECTORS_CACHE_PATH)) {
    console.error("❌ Vectors cache not found! Please run testVectorSearch.ts first to generate vectors.");
    return;
  }

  // 1. Load Data
  console.log("📥 Loading Vectors...");
  const summaryVectors: SummaryVector[] = JSON.parse(fs.readFileSync(VECTORS_CACHE_PATH, 'utf8'));
  console.log(`✅ Loaded ${summaryVectors.length} vectors.`);

  if (summaryVectors.length === 0) {
    console.error("No vectors to cluster.");
    return;
  }

  // Extract raw vectors
  const vectors = summaryVectors.map(sv => sv.vector);

  // 2. Dimensionality Reduction with UMAP
  console.log("🌌 Running UMAP for 2D projection... (This might take a few seconds)");
  // For small datasets, lower nNeighbors helps reveal local structure
  const umap = new UMAP({
    nComponents: 2,
    nEpochs: 400,
    nNeighbors: Math.max(2, Math.min(15, vectors.length - 1)),
    minDist: 0.1,
  });
  
  const projection = umap.fit(vectors);

  // 3. Document Clustering with HDBSCAN
  console.log("📊 Running HDBSCAN clustering...");
  // HDBSCAN handles noise (assigned to cluster -1) and auto-detects optimal clusters
  const hdbscan = new HDBSCAN({
    minClusterSize: 3,
    minSamples: 2,
  });
  
  // We cluster on the original high-dimensional vectors for better semantic grouping
  hdbscan.fit(vectors);
  const clusters = hdbscan.labels_;
  
  // Combine data
  const plotData = summaryVectors.map((sv, i) => ({
    topic: sv.topic,
    summary: sv.summary,
    chunkId: sv.chunkId,
    x: projection[i][0],
    y: projection[i][1],
    cluster: clusters[i]
  }));

  // 4. Generate HTML File with Plotly.js
  console.log("🖼️ Generating HTML visualisation...");

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Topic Clusters Visualization</title>
  <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #1a1a2e; color: #fff; }
    #header { padding: 15px 30px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 500; }
    p { margin: 5px 0 0; color: #aaa; font-size: 0.9rem; }
    #plot { width: 100vw; height: calc(100vh - 75px); }
  </style>
</head>
<body>
  <div id="header">
    <h1>Semantic Clusters of Chat Topics</h1>
    <p>Hover over points to read the topic summary. Each point represents a summarized topic embedded via bhasha-embed-onnx, reduced to 2D with UMAP, and clustered with HDBSCAN.</p>
  </div>
  <div id="plot"></div>
  <script>
    const rawData = ${JSON.stringify(plotData)};
    
    // Group by cluster
    const clustersMap = {};
    rawData.forEach(d => {
      if (!clustersMap[d.cluster]) clustersMap[d.cluster] = { x: [], y: [], text: [], count: 0 };
      clustersMap[d.cluster].x.push(d.x);
      clustersMap[d.cluster].y.push(d.y);
      
      // Word wrap utility for the summary
      const wrappedSummary = d.summary.replace(/(?![^\\n]{1,60}$)([^\\n]{1,60})\\s/g, '$1<br>');
      
      // Format text for hover
      clustersMap[d.cluster].text.push(
        "<b>" + d.topic + "</b><br><br>" + 
        wrappedSummary + 
        "<br><br><span style='color: #aaa;'>Chunk: " + d.chunkId + "</span>"
      );
      clustersMap[d.cluster].count++;
    });

    const colors = [
      '#FF5E5B', '#D8D27B', '#00CECB', '#FFED66', '#FF9F1C', 
      '#2EC4B6', '#E71D36', '#87A330', '#A5243D', '#544EE6'
    ];

    const traces = Object.keys(clustersMap).map((clusterId, i) => {
      const isNoise = clusterId === "-1";
      const clusterColor = isNoise ? '#555555' : colors[i % colors.length];
      const clusterName = isNoise ? 'Noise (' + clustersMap[clusterId].count + ' topics)' : 'Cluster ' + clusterId + ' (' + clustersMap[clusterId].count + ' topics)';

      return {
        x: clustersMap[clusterId].x,
        y: clustersMap[clusterId].y,
        text: clustersMap[clusterId].text,
        mode: 'markers',
        type: 'scatter',
        name: clusterName,
        hoverinfo: 'text',
        hoverlabel: {
          bgcolor: '#2b2b36',
          bordercolor: clusterColor,
          font: { family: 'sans-serif', size: 13, color: '#ffffff' }
        },
        marker: { 
          size: isNoise ? 8 : 11, 
          opacity: isNoise ? 0.4 : 0.85,
          color: clusterColor,
          line: { color: isNoise ? '#888' : '#ffffff', width: 1 }
        }
      };
    });

    const layout = {
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#1a1a2e',
      font: { color: '#e0e0e0' },
      hovermode: 'closest',
      margin: { t: 30, l: 30, r: 30, b: 30 },
      xaxis: { showgrid: true, gridcolor: '#2a2a3e', zeroline: false, showticklabels: false },
      yaxis: { showgrid: true, gridcolor: '#2a2a3e', zeroline: false, showticklabels: false },
      legend: { font: { color: '#fff' }, bgcolor: 'rgba(0,0,0,0)' }
    };

    Plotly.newPlot('plot', traces, layout, { responsive: true, displayModeBar: false });
  </script>
</body>
</html>`;

  fs.writeFileSync(OUTPUT_HTML_PATH, htmlContent, 'utf8');
  console.log(`✅ Visualisation saved to: ${OUTPUT_HTML_PATH}`);
  console.log("🌐 Open the file above in your browser to explore the clusters interactively.");
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
