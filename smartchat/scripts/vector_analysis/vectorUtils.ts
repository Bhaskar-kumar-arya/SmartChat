import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_SLUG = MODEL_NAME.replace(/[/\\]/g, '_');
export const SUMMARIES_DIR = path.resolve(__dirname, '../../chat_summaries');
export const VECTORS_CACHE_PATH = path.resolve(__dirname, `../../chat_summaries_vectors_${MODEL_SLUG}.json`);

export interface Message {
  id: string;
  text: string;
  sender: string;
  ts: string;
}

export interface TopicData {
  topic: string;
  rewrite: string;
  messages: Message[];
  chatName: string;
  chatJid: string;
}

export interface SummaryVector extends TopicData {
  docId: number;
  chunkId: number;
  vector: number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface BM25Index {
  docs: string[][];
  df: Map<string, number>;
  avgDocLen: number;
  N: number;
}

export function buildBM25Index(corpus: string[]): BM25Index {
  const docs: string[][] = corpus.map(tokenise);
  const df = new Map<string, number>();

  for (const tokens of docs) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const avgDocLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  return { docs, df, avgDocLen, N: docs.length };
}

export function bm25Score(
  index: BM25Index,
  docIdx: number,
  queryTerms: string[],
  k1: number = 1.5,
  b: number = 0.75
): number {
  const { docs, df, avgDocLen, N } = index;
  const doc = docs[docIdx];
  const docLen = doc.length;

  const tf = new Map<string, number>();
  for (const t of doc) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const termTF = tf.get(term) ?? 0;
    if (termTF === 0) continue;

    const docFreq = df.get(term) ?? 0;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const tfNorm = (termTF * (k1 + 1)) /
      (termTF + k1 * (1 - b + b * (docLen / avgDocLen)));

    score += idf * tfNorm;
  }

  return score;
}

export async function getEmbeddingExtractor() {
  return await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true,
  });
}

export async function embedText(extractor: any, text: string): Promise<number[]> {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}

export function getPassageText(item: TopicData): string {
  const msgsText = (item.messages || []).map((m: any) => `[${m.ts}] ${m.sender}: ${m.text}`).join('\n');
  return `passage: ${item.topic}: ${item.rewrite}\n${msgsText}`;
}
