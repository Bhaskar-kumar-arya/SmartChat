# Chat Disentanglement for WhatsApp — Problem & Solution Design

## 1. Problem Statement

### 1.1 What is Chat Disentanglement?

In real-world instant messaging platforms like WhatsApp, conversations do not flow
in a single linear thread. Multiple participants frequently engage in several
concurrent, overlapping discussions within the same chat window. The raw message
stream is chronologically ordered but topically chaotic — consecutive messages
often belong to entirely different conversational threads.

Chat disentanglement is the task of taking this interleaved, chronological message
stream and reconstructing the distinct conversational threads that exist within it.

### 1.2 The Interleaving Problem

Consider the following example:

```
[0] Rahul  : did you submit the assignment?
[1] Priya  : also what time is the party?
[2] Arjun  : yes submitted last night
[3] Sam    : i can come around 8
[4] Rahul  : nice, was it hard?
[5] Priya  : 8 works for me too
[6] Arjun  : not really, just took time
```

The expected output is two reconstructed threads:

- Thread A — Assignment: `[0, 2, 4, 6]`
- Thread B — Party timing: `[1, 3, 5]`

These threads are interleaved in the raw stream. No contiguous segment boundary
exists between them. This makes classical text segmentation approaches — which
assume topics form contiguous blocks — completely invalid for this problem.

### 1.3 Why Naive Approaches Fail

**Sliding window / TextTiling approaches** assume topics are contiguous blocks of
text separated by detectable boundary points. They find valley points in
similarity curves between adjacent message groups. This breaks entirely when
threads are interleaved — there is no boundary to find.

**Hard time windows** (e.g. "group messages within 20 minutes") fail because:
- People put their phone down and reply much later to the same thread
- A short time gap does not imply a topic shift
- A small time gap does not imply the same topic
- Time is a weak proxy for thread membership

**Pure semantic similarity clustering** (embed each message, cluster vectors)
fails because:
- Short, low-entropy messages like "yes", "ok", "haha", "thanks" have nearly
  identical embeddings regardless of what they are responding to
- These messages are entirely dependent on their conversational context for meaning
- Isotropic embedding spaces cause unrelated "yes" messages to cluster together

**Contiguous boundary detection** fails because it assumes each message has at
most one successor in the same thread, which is not true. A single message can
simultaneously be the parent of several independent replies from different
participants.

### 1.4 Specific Structural Properties of the Problem

The following properties make this problem non-trivial and must be accounted for
in any viable solution:

**One-to-many reply structure.** A single message can be directly replied to by
several subsequent messages. These replies may themselves branch further.

**Overlapping concurrent threads.** Two or more threads can be active
simultaneously, with messages from different threads interleaved arbitrarily.

**No explicit metadata.** WhatsApp plain-text exports do not carry system-level
reply-to identifiers or thread markers. The only available signals are the message
text, sender name, and timestamp.

**Multilingual and code-switched text.** Real WhatsApp chats in India and similar
contexts are heavily code-switched between languages (e.g. Hindi-English, also
known as Hinglish). Any model must handle multilingual input natively.

**Short, ambiguous messages.** A significant fraction of chat messages are
semantically vacuous in isolation ("yes", "lol", "done", "ok sure"). They require
surrounding context to be correctly assigned.

**No predefined thread count.** The number of concurrent threads in any given
window is unknown in advance and varies per conversation.

---

## 2. Problem Formulation

Given a chronologically ordered sequence of messages:

```
M = [m_0, m_1, m_2, ..., m_n]
```

where each message `m_i` carries a sender, timestamp, and text, the goal is to
reconstruct a directed reply graph `G`:

```
G = (V, E)

V = {m_0, m_1, ..., m_n}

E = {(i, j) | message j is a direct reply to message i, i < j}
```

From this graph, conversational threads are extracted as **connected components**.
Since a message can reply to multiple parents, and a message can receive replies
from multiple children, the graph is a directed acyclic graph (DAG), not a simple
tree.

Threads are the weakly connected components of this DAG.

---

## 3. Solution Design

### 3.1 Core Insight

The problem reduces to **link prediction** in the reply graph. Instead of
clustering messages directly, we predict edges — specifically, for each pair
`(i, j)` where `i < j`, we predict whether `j` is a direct reply to `i`.

This reframing is powerful for several reasons:

- It is a well-studied problem in NLP (response selection, dialogue modeling)
- It naturally handles one-to-many reply structures
- It does not require knowing the number of threads in advance
- It can leverage rich pretrained language models
- It allows contextual reasoning across both the candidate parent and the target
  message simultaneously

### 3.2 The Cross-Encoder Architecture

The core model is a **cross-encoder binary classifier**.

A cross-encoder jointly encodes a pair of inputs in a single forward pass,
allowing every token in input A to attend to every token in input B via the
full self-attention mechanism. This is fundamentally different from a bi-encoder
(which embeds each input separately and compares vectors), because the model can
directly reason about the relationship between the two inputs.

The input format is:

```
[CLS] context_around_i [SEP] message_j [SEP]
```

The `[CLS]` token's final hidden state represents the relationship between the
two inputs. A linear classification head maps this to a scalar probability:

```
P(j replies to i) = sigmoid(Linear(cls_vector))
```

### 3.3 Why Cross-Encoder over Bi-Encoder

A bi-encoder computes:

```
similarity = cosine(embed(ctx_i), embed(msg_j))
```

The two messages never directly interact during encoding. This fails for our
problem because the reply relationship is deeply relational — whether "yes"
replies to message A or message B cannot be determined by comparing their
vectors independently. The model must see both simultaneously.

A cross-encoder encodes both messages jointly, so attention heads can model
token-level interactions across the pair. This is significantly more accurate
for reply-to prediction at the cost of being slower (cannot precompute
embeddings).

### 3.4 Context Augmentation

Since short messages are semantically vacuous in isolation, both the candidate
parent and the target message are augmented with surrounding conversational
context before being fed to the model.

The input is constructed as:

```
context_i = [msg_{i-4}, msg_{i-3}, msg_{i-2}, msg_{i-1}, msg_i]
             (last 4 messages before i, plus i itself)

msg_j      = just message j (no trailing context, since j is the newest message)
```

Each message in the context is prefixed with the sender name:

```
"Rahul: did you submit? | Priya: yes done | Rahul: nice"
```

Sender names are critical — they encode who is responding to whom, which is one
of the strongest signals for reply-to prediction.

The total token budget for XLM-RoBERTa (512 token max):

```
Special tokens        :   3 tokens  ([CLS], [SEP], [SEP])
context_i (5 msgs)    : ~200 tokens (40 tokens/msg avg, including sender prefix)
msg_j                 :  ~50 tokens
Total                 : ~253 tokens  (safe headroom for Hinglish tokenization)
```

### 3.5 Candidate Window

For each target message `j`, we do not score against all prior messages. We
restrict the candidate set to the **20 most recent prior messages**:

```
candidates(j) = {i | max(0, j-20) ≤ i < j}
```

This window is not time-based — it is count-based. Research on real chat corpora
shows that over 95% of direct reply-to links fall within 20 prior messages,
regardless of elapsed time. A count-based window correctly handles delayed replies
that a time-based window would miss.

### 3.6 Scoring and Edge Construction

For each candidate pair `(i, j)`, the cross-encoder produces a score:

```
score(i, j) = P(j replies to i)
```

An edge is added to the reply graph if the score exceeds a threshold τ:

```
E = {(i, j) | score(i, j) > τ}
```

Critically, we use a **threshold**, not an argmax. This is necessary because:

- A message can reply to multiple parents simultaneously
- Argmax would only capture one link per message, missing one-to-many structure
- The threshold allows j to be linked to all valid parents

The threshold τ is calibrated on a held-out validation set to maximize F1 on
link prediction. A dynamic per-message threshold (mean + k×std of scores within
the window) can also be used to adapt to varying conversation densities.

### 3.7 Thread Reconstruction

Once the reply graph edges are established, threads are extracted as **weakly
connected components** of the DAG:

```
Thread = weakly connected component of G = (V, E)
```

This correctly handles:

- Chain replies: `0 → 2 → 5` puts all three in the same thread even if 5 never
  directly links to 0
- One-to-many: `0 ← 1, 0 ← 2, 0 ← 3` puts all four in one thread
- Interleaved threads: messages from different components are cleanly separated
  regardless of their temporal positions

---

## 4. Base Model Selection

### 4.1 Multilingual Requirement

Standard English-only BERT variants (BERT-base, MobileBERT, DistilBERT) are
unsuitable because the target data is multilingual and code-switched. A
multilingual base model is required.

### 4.2 Candidate Models

| Model | Parameters | Key Property |
|---|---|---|
| mBERT (bert-base-multilingual-cased) | 179M | Baseline multilingual |
| XLM-RoBERTa base | 278M | Strong multilingual, handles code-switching |
| XLM-RoBERTa large | 560M | Best quality, under 1B budget |
| LaBSE | 471M | Trained on code-switched and low-resource pairs |
| MiniLM-L6-multilingual | 118M | Fastest, weaker on Hinglish |

### 4.3 Recommendation

**XLM-RoBERTa base** is the primary recommendation — it is the industry standard
for multilingual NLP tasks, handles Hindi-English code-switching well, is well
documented, and has a strong finetuning baseline.

**LaBSE** is a strong alternative if the chat data is predominantly Hinglish or
other code-switched pairs, as it was specifically trained on cross-lingual
sentence pairs including low-resource languages.

Both are well within the ≤1B parameter constraint.

### 4.4 Finetuning, Not Training From Scratch

The model is **finetuned**, not trained from scratch. XLM-RoBERTa already
understands multilingual semantics, grammar, and conversational patterns from
pretraining. Finetuning teaches it the specific reply-to relationship on chat data.
Training from scratch at this scale would require orders of magnitude more data
and compute for no meaningful gain.

---

## 5. Training Data Design

### 5.1 Data Source

Training data is generated from real WhatsApp chat exports from SmartChat. This
ensures the training distribution matches the deployment distribution — same
languages, same informal style, same emoji and abbreviation patterns.

### 5.2 LLM Annotation Pipeline

A large language model (e.g. Claude, Gemini) is used to annotate windows of
messages with ground truth reply-to links. The LLM is given a window of 20-30
consecutive messages and asked to output a reply-to adjacency list in JSON format:

```json
{
  "links": [
    {"msg": 0, "replies_to": null},
    {"msg": 1, "replies_to": null},
    {"msg": 2, "replies_to": [0]},
    {"msg": 3, "replies_to": [1]},
    {"msg": 4, "replies_to": [0, 2]},
    {"msg": 5, "replies_to": null}
  ]
}
```

Key properties of this format:

- `replies_to` is a list, not a scalar — handles one-to-many correctly
- `null` indicates a thread-initiating message with no parent in the window
- Message indices are positions within the window, not global IDs

The LLM is instructed to reason from semantic content and sender identity, not
message position or time.

### 5.3 Free Labels from Native Quote-Replies

WhatsApp's native quote-reply feature, when exported to text, produces quoted
message content within the reply. These are **ground truth reply-to links at zero
annotation cost** and should be mined from the existing SmartChat data before any
LLM annotation. These pairs form the highest-quality subset of the training data.

### 5.4 Pair Extraction from Annotations

From each annotated window, training pairs are extracted as follows:

**Positive pairs** — `(ctx_i, msg_j, label=1)`:
For every link `j → i` in the adjacency list, one positive pair is created.

**Hard negative pairs** — `(ctx_i, msg_j, label=0)`:
For every message `j`, 2-3 messages from the same window that are NOT parents
of `j` are sampled as negatives. These are hard negatives — they come from the
same temporal context and may be topically adjacent, forcing the model to learn
subtle distinctions.

Hard negatives are far more valuable than easy negatives (random messages from
different chats), which the model learns to reject trivially.

### 5.5 Quality Filtering

LLM annotations on ambiguous short messages may be unreliable. Two quality gates
are applied:

**Structural validation** — the JSON output is validated for consistency:
reply-to indices must be less than the message index (no future-pointing links),
all indices must exist within the window, and every message must appear exactly
once.

**Dual LLM agreement** — the same window is annotated by two different LLMs.
Only pairs where both models agree are retained. Disagreement indicates genuine
ambiguity, which produces noisy training signal and should be discarded.

### 5.6 Target Dataset Size

For finetuning a cross-encoder on binary classification, the following is a
practical target:

```
Annotated windows  : 500 - 1,000 windows of 20-30 messages each
Positive pairs     : ~5,000 - 15,000
Hard negative pairs: ~15,000 - 45,000  (3× positives)
Total pairs        : ~20,000 - 60,000
```

This is achievable from SmartChat's existing chat data without any external
dataset collection.

---

## 6. Inference Pipeline for Historical Messages

### 6.1 Scope

For a corpus of N historical messages (e.g. N = 100,000), all message pairs
within each sliding window must be scored. This is a batch offline process.

### 6.2 Total Pair Count

For each message `j`, at most 20 candidate predecessors exist:

```
Total pairs ≈ 20 × N = 20 × 100,000 = 2,000,000 pairs
```

### 6.3 Memory Strategy

All 2,000,000 tokenized pairs cannot be held in memory simultaneously (~4GB for
input tensors alone). Pairs are generated lazily via a generator and processed
in chunks of ~10,000 pairs at a time. Memory footprint remains flat at ~100MB
regardless of N.

### 6.4 Throughput Estimates

| Hardware | Estimated Throughput | Time for 2M pairs |
|---|---|---|
| CPU, vanilla PyTorch | ~175 pairs/sec | ~3.2 hours |
| CPU, ONNX quantized | ~500 pairs/sec | ~1.1 hours |
| GPU (consumer, e.g. RTX 3060) | ~4,000 pairs/sec | ~8 minutes |
| GPU (datacenter, e.g. A100) | ~15,000 pairs/sec | ~2 minutes |

For a one-time historical batch job, ~1 hour on CPU with ONNX quantization is
acceptable.

### 6.5 Optional Pre-filtering with Bi-Encoder

If CPU inference time must be reduced, a fast bi-encoder (e.g. Model2Vec
potion-base-8M, capable of 25,000+ sentences/second) can be used as a
pre-filter. For each message `j`, the bi-encoder scores all 20 candidates and
retains only the top 5. The cross-encoder then only processes 5 pairs per
message instead of 20, reducing total pairs from 2M to 500,000 — approximately
4× faster, with minimal quality loss if bi-encoder recall@5 is high.

### 6.6 Output

The inference pipeline produces a list of directed edges `(i, j)` where
`score(i, j) > τ`. A standard connected components algorithm (e.g. Union-Find)
is then run over the full message set to assign each message a thread ID.

---

## 7. Design Summary

```
Problem       : Reconstruct interleaved conversational threads from a flat
                WhatsApp message stream, where threads overlap and a single
                message can be the parent of multiple replies.

Formulation   : Link prediction in a directed reply graph. Predict edges
                (i → j) meaning "message j is a direct reply to message i".
                Threads = weakly connected components of the resulting DAG.

Model         : Cross-encoder binary classifier (XLM-RoBERTa base or LaBSE)
                finetuned on reply-to pair classification.

Input format  : [CLS] context_around_i (5 msgs) [SEP] message_j [SEP]
                Sender names included. Max ~256 tokens per pair.

Candidate set : Last 20 messages before j (count-based, not time-based).

Edge rule     : Add edge (i, j) if score(i, j) > threshold τ.
                Threshold, not argmax — allows one-to-many reply structure.

Training data : LLM-annotated windows from SmartChat WhatsApp exports.
                Native quote-reply pairs as free ground truth labels.
                Hard negatives sampled from same window as positives.

Inference     : Lazy pair generation → batched ONNX cross-encoder scoring
                → edge list → connected components → thread IDs.

Scale         : N=100,000 messages → 2M pairs → ~1 hour CPU (ONNX quantized).
```