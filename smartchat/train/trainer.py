"""
Chat Thread Reply Scorer — Full Training Pipeline
==================================================
Task:
    Given (thread_context, candidate_message_mj) → score ∈ [0, 1]
    1.0 = message definitely replies to this thread
    0.0 = message is unrelated to this thread

Inputs:
    threads.json       — output of disentanglement script; contains thread clusters
                         with per-message text, sender, timestamp, globalIndex
    annotations.jsonl  — contains the link map (globalIndex → replies_to)

Architecture:
    BERT encoder with a binary classification head.
    Input: [CLS] <thread messages> [SEP] <candidate message> [SEP]
    Output: sigmoid(linear(CLS_embedding)) → scalar score ∈ [0, 1]

Training data construction:
    For each message mj in annotations:
      - replies_to = [i, ...]  →  find thread(s) containing i  →  POSITIVE pair  (label=1)
      - sample neg_per_pos other threads mj does NOT belong to  →  NEGATIVE pairs (label=0)
      - replies_to = null      →  all sampled threads are negatives
"""

import json
import random
import os
import argparse
import sqlite3
import re
from pathlib import Path
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional
import tempfile

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from transformers import AutoTokenizer, AutoModel, get_linear_schedule_with_warmup
from torch.optim import AdamW
from sklearn.metrics import roc_auc_score, classification_report
import numpy as np
from tqdm import tqdm


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Config:
    # Paths
    threads_path: str      = "train/threads"
    annotations_path: str  = "train/annotations.jsonl"
    output_dir: str        = "reply_scorer_output"

    # Model
    # bert-base-multilingual-cased handles Hinglish / mixed-script chat well.
    # Swap to "google/muril-base-cased" for stronger Indic language coverage.
    model_name: str  = "bert-base-multilingual-cased"
    max_seq_len: int = 512

    # Data construction
    neg_per_pos: int      = 3    # negative thread samples per positive pair
    thread_max_msgs: int  = 10   # use the N most recent thread messages as context
    min_thread_size: int  = 1    # skip threads smaller than this as negatives
    val_split: float      = 0.15
    test_split: float     = 0.10
    seed: int             = 42

    # Training
    batch_size: int      = 16
    learning_rate: float = 2e-5
    epochs: int          = 5
    warmup_ratio: float  = 0.1
    weight_decay: float  = 0.01
    # Upweight positives since negatives dominate (1 pos : neg_per_pos neg)
    pos_weight: float    = 3.0

    # Inference
    top_k: int = 5   # score top-K recent threads per candidate message

    # Testing / Diagnostics
    limit_threads: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: LOAD threads.json
# ─────────────────────────────────────────────────────────────────────────────

def extract_quoted_id(content):
    if not isinstance(content, dict):
        return None
    if "contextInfo" in content and isinstance(content["contextInfo"], dict):
        stanza_id = content["contextInfo"].get("stanzaId")
        if stanza_id:
            return stanza_id
    for val in content.values():
        if isinstance(val, dict):
            res = extract_quoted_id(val)
            if res:
                return res
    return None


def get_quote_replies_map(db_path="prisma/dev.db"):
    quote_map = {}
    if not os.path.exists(db_path):
        print(f"  [Warning] SQLite DB not found at '{db_path}'. Quote heuristic fallback will not have DB lookup.")
        return quote_map
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT id, content FROM Message WHERE content IS NOT NULL")
        rows = cursor.fetchall()
        for msg_id, content_str in rows:
            try:
                content = json.loads(content_str)
                quoted_id = extract_quoted_id(content)
                if quoted_id:
                    quote_map[msg_id] = quoted_id
            except Exception:
                continue
        conn.close()
    except Exception as e:
        print(f"  [Warning] Failed to read SQLite DB: {e}")
    return quote_map


def load_threads(threads_path: str, db_path: str = "prisma/dev.db") -> tuple:
    """
    Parse threads from a file or a directory of chat threads JSON files.
    """
    if not os.path.exists(db_path):
        db_path = "../prisma/dev.db"
    if not os.path.exists(db_path):
        db_path = "smartchat/prisma/dev.db"
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prisma/dev.db")

    quote_map = get_quote_replies_map(db_path)
    quote_reply_gidxs = set()

    # Fallback pathing resolution
    if not os.path.exists(threads_path):
        if threads_path == "train/threads" and os.path.isdir("threads"):
            threads_path = "threads"
        elif threads_path == "threads" and os.path.isdir("train/threads"):
            threads_path = "train/threads"

    files_to_load = []
    if os.path.isdir(threads_path):
        for filename in sorted(os.listdir(threads_path)):
            if filename.endswith(".json"):
                files_to_load.append(os.path.join(threads_path, filename))
    else:
        files_to_load.append(threads_path)

    thread_clusters = {}
    msg_texts       = {}
    msg_to_thread   = {}
    chat_offsets    = {}
    msg_to_chat     = {}
    thread_to_chat  = {}

    for idx, filepath in enumerate(files_to_load):
        if os.path.isdir(threads_path):
            chat_jid = os.path.basename(filepath)[:-5]
        else:
            chat_jid = "120363420635575284@g.us"

        offset = idx * 1000000
        chat_offsets[chat_jid] = offset

        with open(filepath, "r", encoding="utf-8") as f:
            raw_threads = json.load(f)

        for thread in raw_threads:
            tid = thread["threadId"]
            unique_tid = f"{chat_jid}_{tid}"
            thread_to_chat[unique_tid] = chat_jid

            messages = sorted(thread["messages"], key=lambda m: m["globalIndex"])
            
            offset_messages = []
            for msg in messages:
                new_msg = dict(msg)
                new_msg["globalIndex"] = msg["globalIndex"] + offset
                offset_messages.append(new_msg)

            thread_clusters[unique_tid] = offset_messages

            for msg in offset_messages:
                gidx = msg["globalIndex"]
                msg_id = msg.get("messageId")
                if msg_id and msg_id in quote_map:
                    quote_reply_gidxs.add(gidx)

                msg_texts[gidx] = f"[{msg['timeString']}] {msg['sender']}: {msg['text']}"
                msg_to_thread[gidx] = unique_tid
                msg_to_chat[gidx] = chat_jid

    return thread_clusters, msg_texts, msg_to_thread, quote_reply_gidxs, chat_offsets, msg_to_chat, thread_to_chat


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: LOAD annotations.jsonl → global link map
# ─────────────────────────────────────────────────────────────────────────────

def load_link_map(annotations_path: str, chat_offsets: dict) -> dict:
    """
    Reconstruct globalIndex -> [parent_globalIndex, ...] | None
    from annotations.jsonl using "First Annotation Wins" logic,
    adjusted with chat offsets.
    """
    if not os.path.exists(annotations_path):
        # fallback pathing
        if annotations_path == "annotations.jsonl" and os.path.exists("train/annotations.jsonl"):
            annotations_path = "train/annotations.jsonl"
        elif annotations_path == "train/annotations.jsonl" and os.path.exists("annotations.jsonl"):
            annotations_path = "annotations.jsonl"

    records = []
    if os.path.exists(annotations_path):
        with open(annotations_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    records.sort(key=lambda r: r["windowIndex"])

    link_map              = {}
    has_established_edge  = set()

    for record in records:
        chat_jid = record.get("chatJid", "120363420635575284@g.us")
        offset = chat_offsets.get(chat_jid)
        if offset is None:
            # Skip if we didn't load this chat's threads
            continue

        start = record["startIndex"]
        links = record.get("annotation", {}).get("links", [])

        for link in links:
            global_j   = offset + start + link["msg"]
            replies_to = link.get("replies_to")

            if isinstance(replies_to, list) and len(replies_to) > 0:
                if global_j not in has_established_edge:
                    link_map[global_j] = [offset + start + p for p in replies_to]
                    has_established_edge.add(global_j)
            else:
                if global_j not in has_established_edge:
                    link_map[global_j] = None

    return link_map


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: BUILD TRAINING PAIRS
# ─────────────────────────────────────────────────────────────────────────────

def format_thread_context(thread_msgs, before_global_idx, max_msgs, msg_texts):
    """
    Produce a single string from the N most recent thread messages that
    appeared BEFORE message mj (no leakage of future messages).
    Messages are joined with ' | '.
    """
    eligible = [m for m in thread_msgs if m["globalIndex"] < before_global_idx]
    recent   = eligible[-max_msgs:]
    parts = [msg_texts[m["globalIndex"]] for m in recent if m["globalIndex"] in msg_texts]
    return " | ".join(parts)


def build_training_pairs(link_map, thread_clusters, msg_texts, msg_to_thread, quote_reply_gidxs, msg_to_chat, thread_to_chat, cfg, rng):
    """
    For each annotated message mj:
      Positive  (label=1): thread(s) it actually replies to
      Negatives (label=0): randomly sampled threads it does NOT belong to (restricted to same chat)
    """
    all_thread_ids = [
        tid for tid, msgs in thread_clusters.items()
        if len(msgs) >= cfg.min_thread_size
    ]

    pairs = []

    for global_j, parents in link_map.items():
        if global_j in quote_reply_gidxs:
            continue
        if global_j not in msg_texts:
            continue

        candidate_text = msg_texts[global_j]
        positive_tids  = set()

        # ── POSITIVES ─────────────────────────────────────────────────────────
        if parents:
            for p in parents:
                if p in msg_to_thread:
                    positive_tids.add(msg_to_thread[p])

        for pos_tid in positive_tids:
            thread_text = format_thread_context(
                thread_clusters[pos_tid], global_j, cfg.thread_max_msgs, msg_texts
            )
            if not thread_text:
                continue
            pairs.append({
                "thread_text":  thread_text,
                "message_text": candidate_text,
                "label":        1.0
            })

        # ── NEGATIVES ─────────────────────────────────────────────────────────
        own_tid = msg_to_thread.get(global_j)
        chat_jid = msg_to_chat.get(global_j)
        
        eligible_neg_tids = [
            tid for tid in all_thread_ids
            if tid not in positive_tids
            and tid != own_tid
            and thread_to_chat.get(tid) == chat_jid
            and any(m["globalIndex"] < global_j for m in thread_clusters[tid])
        ]

        n_neg        = cfg.neg_per_pos * max(1, len(positive_tids))
        sampled_negs = rng.sample(eligible_neg_tids, min(n_neg, len(eligible_neg_tids)))

        for neg_tid in sampled_negs:
            thread_text = format_thread_context(
                thread_clusters[neg_tid], global_j, cfg.thread_max_msgs, msg_texts
            )
            if not thread_text:
                continue
            pairs.append({
                "thread_text":  thread_text,
                "message_text": candidate_text,
                "label":        0.0
            })

    rng.shuffle(pairs)
    return pairs


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: DATASET
# ─────────────────────────────────────────────────────────────────────────────

def truncate_middle(token_ids, target_len, marker_ids=None):
    target_len = max(0, target_len)
    if len(token_ids) <= target_len:
        return token_ids

    if marker_ids:
        marker_len = len(marker_ids)
        if target_len > marker_len:
            target_len -= marker_len
        else:
            marker_ids = None

    half = target_len // 2
    left = token_ids[:half]
    right = token_ids[-(target_len - half):]

    if marker_ids:
        return left + marker_ids + right
    return left + right


def prepare_middle_truncated_input(tokenizer, text1, text2, max_seq_len):
    # Tokenize separately without special tokens
    t1_enc = tokenizer(text1, add_special_tokens=False)
    t2_enc = tokenizer(text2, add_special_tokens=False)

    ids1 = t1_enc["input_ids"]
    ids2 = t2_enc["input_ids"]

    target_len1 = len(ids1)
    target_len2 = len(ids2)

    # 3 special tokens: [CLS] text1 [SEP] text2 [SEP]
    excess = (len(ids1) + len(ids2)) - (max_seq_len - 3)
    if excess > 0:
        if len(ids1) > len(ids2):
            diff = len(ids1) - len(ids2)
            reduce1 = min(excess, diff)
            target_len1 -= reduce1
            excess -= reduce1
        elif len(ids2) > len(ids1):
            diff = len(ids2) - len(ids1)
            reduce2 = min(excess, diff)
            target_len2 -= reduce2
            excess -= reduce2

        if excess > 0:
            reduce_each = excess // 2
            target_len1 -= reduce_each
            target_len2 -= (excess - reduce_each)

    target_len1 = max(0, target_len1)
    target_len2 = max(0, target_len2)

    marker_ids = tokenizer.encode("...", add_special_tokens=False)
    ids1 = truncate_middle(ids1, target_len1, marker_ids)
    ids2 = truncate_middle(ids2, target_len2, marker_ids)

    cls_id = tokenizer.cls_token_id
    sep_id = tokenizer.sep_token_id
    pad_id = tokenizer.pad_token_id

    input_ids = [cls_id] + ids1 + [sep_id] + ids2 + [sep_id]
    token_type_ids = [0] * (len(ids1) + 2) + [1] * (len(ids2) + 1)

    padding_len = max_seq_len - len(input_ids)
    attention_mask = [1] * len(input_ids) + [0] * padding_len
    input_ids = input_ids + [pad_id] * padding_len
    token_type_ids = token_type_ids + [0] * padding_len

    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "attention_mask": torch.tensor(attention_mask, dtype=torch.long),
        "token_type_ids": torch.tensor(token_type_ids, dtype=torch.long)
    }


class ThreadReplyDataset(Dataset):
    def __init__(self, pairs, tokenizer, max_seq_len):
        self.pairs       = pairs
        self.tokenizer   = tokenizer
        self.max_seq_len = max_seq_len

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        pair = self.pairs[idx]

        inputs = prepare_middle_truncated_input(
            self.tokenizer,
            pair["thread_text"],
            pair["message_text"],
            self.max_seq_len
        )

        return {
            "input_ids":      inputs["input_ids"],
            "attention_mask": inputs["attention_mask"],
            "token_type_ids": inputs["token_type_ids"],
            "label":          torch.tensor(pair["label"], dtype=torch.float)
        }


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: MODEL
# ─────────────────────────────────────────────────────────────────────────────

class ThreadReplyScorer(nn.Module):
    """
    BERT encoder + lightweight classification head.

    Forward pass:
        [CLS] thread_context [SEP] candidate_message [SEP]
            -> BERT encoder
            -> CLS token embedding  (shape: B x H)
            -> Dropout -> Linear(H, H/2) -> GELU -> Dropout -> Linear(H/2, 1)
            -> sigmoid  ->  score in [0, 1]
    """

    def __init__(self, model_name, dropout=0.1):
        super().__init__()
        self.encoder  = AutoModel.from_pretrained(model_name)
        hidden_size   = self.encoder.config.hidden_size

        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, 1)
        )

    def forward(self, input_ids, attention_mask, token_type_ids=None):
        out     = self.encoder(input_ids, attention_mask, token_type_ids)
        cls_emb = out.last_hidden_state[:, 0, :]       # (B, H)
        logits  = self.classifier(cls_emb).squeeze(-1)  # (B,)
        return torch.sigmoid(logits)                    # (B,) in [0, 1]

    def forward_logits(self, input_ids, attention_mask, token_type_ids=None):
        """Raw logits (pre-sigmoid) for BCEWithLogitsLoss during training."""
        out     = self.encoder(input_ids, attention_mask, token_type_ids)
        cls_emb = out.last_hidden_state[:, 0, :]
        return self.classifier(cls_emb).squeeze(-1)     # (B,)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: TRAINING & EVALUATION
# ─────────────────────────────────────────────────────────────────────────────

def evaluate(model, loader, device):
    model.eval()
    all_labels, all_scores = [], []
    total_loss = 0.0
    criterion  = nn.BCELoss()

    with torch.no_grad():
        for batch in loader:
            input_ids      = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            token_type_ids = batch["token_type_ids"].to(device)
            labels         = batch["label"].to(device)

            scores     = model(input_ids, attention_mask, token_type_ids)
            total_loss += criterion(scores, labels).item()

            all_labels.extend(labels.cpu().numpy())
            all_scores.extend(scores.cpu().numpy())

    all_labels = np.array(all_labels)
    all_scores = np.array(all_scores)
    preds      = (all_scores >= 0.5).astype(int)
    auc        = roc_auc_score(all_labels, all_scores) if len(set(all_labels)) > 1 else 0.0

    return {
        "loss":   total_loss / len(loader),
        "auc":    auc,
        "report": classification_report(
            all_labels, preds,
            target_names=["no_reply", "reply"],
            zero_division=0
        )
    }


def train(cfg):
    random.seed(cfg.seed)
    torch.manual_seed(cfg.seed)
    rng = random.Random(cfg.seed)

    os.makedirs(cfg.output_dir, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}\n")

    # ── Load data ─────────────────────────────────────────────────────────────
    print(f"Loading threads from: {cfg.threads_path}")
    (
        thread_clusters,
        msg_texts,
        msg_to_thread,
        quote_reply_gidxs,
        chat_offsets,
        msg_to_chat,
        thread_to_chat,
    ) = load_threads(cfg.threads_path)
    print(f"  {len(thread_clusters)} threads  |  {len(msg_texts)} messages  |  {len(quote_reply_gidxs)} quote replies")

    if cfg.limit_threads:
        limited_tids = list(thread_clusters.keys())[:cfg.limit_threads]
        thread_clusters = {tid: thread_clusters[tid] for tid in limited_tids}
        msg_texts = {gidx: text for gidx, text in msg_texts.items() if msg_to_thread[gidx] in limited_tids}
        quote_reply_gidxs = {gidx for gidx in quote_reply_gidxs if gidx in msg_texts}
        msg_to_thread = {gidx: tid for gidx, tid in msg_to_thread.items() if tid in limited_tids}
        print(f"  [Limited] {len(thread_clusters)} threads  |  {len(msg_texts)} messages  |  {len(quote_reply_gidxs)} quote replies")

    print(f"Loading link map from: {cfg.annotations_path}")
    link_map  = load_link_map(cfg.annotations_path, chat_offsets)
    n_linked  = sum(1 for v in link_map.values() if v is not None)
    print(f"  {len(link_map)} annotated messages  |  {n_linked} with a reply link")

    # ── Build pairs ───────────────────────────────────────────────────────────
    print("\nBuilding training pairs...")
    pairs     = build_training_pairs(
        link_map,
        thread_clusters,
        msg_texts,
        msg_to_thread,
        quote_reply_gidxs,
        msg_to_chat,
        thread_to_chat,
        cfg,
        rng
    )
    pos_count = sum(1 for p in pairs if p["label"] == 1.0)
    neg_count = len(pairs) - pos_count
    print(f"  {len(pairs)} pairs total  |  {pos_count} positive  |  {neg_count} negative")

    if not pairs:
        raise ValueError(
            "No training pairs generated.\n"
            "Check that threads.json/threads directory and annotations.jsonl are from the same run "
            "and that annotations contain at least some replies_to links."
        )

    # ── Tokenizer & dataset ───────────────────────────────────────────────────
    print(f"\nLoading tokenizer: {cfg.model_name}")
    tokenizer = AutoTokenizer.from_pretrained(cfg.model_name)
    dataset   = ThreadReplyDataset(pairs, tokenizer, cfg.max_seq_len)

    n_total = len(dataset)
    n_val   = int(n_total * cfg.val_split)
    n_test  = int(n_total * cfg.test_split)
    n_train = n_total - n_val - n_test

    train_ds, val_ds, test_ds = random_split(
        dataset, [n_train, n_val, n_test],
        generator=torch.Generator().manual_seed(cfg.seed)
    )
    print(f"  Split — Train: {len(train_ds)}  |  Val: {len(val_ds)}  |  Test: {len(test_ds)}")

    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True,  num_workers=0, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=cfg.batch_size, shuffle=False, num_workers=0, pin_memory=True)
    test_loader  = DataLoader(test_ds,  batch_size=cfg.batch_size, shuffle=False, num_workers=0, pin_memory=True)

    # ── Model & optimiser ─────────────────────────────────────────────────────
    print(f"\nInitialising model: {cfg.model_name}")
    model     = ThreadReplyScorer(cfg.model_name).to(device)
    optimizer = AdamW(model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay)

    total_steps  = len(train_loader) * cfg.epochs
    warmup_steps = int(total_steps * cfg.warmup_ratio)
    scheduler    = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)

    pos_weight_tensor = torch.tensor([cfg.pos_weight], device=device)
    criterion         = nn.BCEWithLogitsLoss(pos_weight=pos_weight_tensor)

    # ── Training loop ─────────────────────────────────────────────────────────
    best_val_auc    = 0.0
    best_model_path = (Path(cfg.output_dir) / "best_model.pt").resolve()

    for epoch in range(1, cfg.epochs + 1):
        model.train()
        epoch_loss = 0.0

        progress_bar = tqdm(enumerate(train_loader, 1), total=len(train_loader), desc=f"Epoch {epoch}")
        for step, batch in progress_bar:
            input_ids      = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            token_type_ids = batch["token_type_ids"].to(device)
            labels         = batch["label"].to(device)

            optimizer.zero_grad()
            logits = model.forward_logits(input_ids, attention_mask, token_type_ids)
            loss   = criterion(logits, labels)
            loss.backward()

            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            epoch_loss += loss.item()
            progress_bar.set_postfix({"loss": f"{epoch_loss/step:.4f}"})

        val_metrics = evaluate(model, val_loader, device)
        print(f"\nEpoch {epoch} — Train loss: {epoch_loss/len(train_loader):.4f} "
              f"| Val loss: {val_metrics['loss']:.4f} | Val AUC: {val_metrics['auc']:.4f}")
        print(val_metrics["report"])

        if val_metrics["auc"] > best_val_auc:
            best_val_auc = val_metrics["auc"]
            
            # Save to a temporary file in the same directory first, then atomically replace the target file
            # to prevent stream write failures/file lock errors caused by Windows OneDrive sync.
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pt", dir=best_model_path.parent) as tmp:
                tmp_path = tmp.name
                
            try:
                torch.save({
                    "epoch":            epoch,
                    "model_state_dict": model.state_dict(),
                    "val_auc":          best_val_auc,
                    "cfg":              cfg.__dict__,
                }, tmp_path)
                os.replace(tmp_path, str(best_model_path))
                print(f"  ✅ Best model saved (Val AUC: {best_val_auc:.4f})\n")
            except Exception as e:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except:
                        pass
                raise e

    # ── Test evaluation ────────────────────────────────────────────────────────
    print("Loading best model for final test evaluation...")
    ckpt = torch.load(best_model_path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])

    test_metrics = evaluate(model, test_loader, device)
    print(f"\n{'='*52}")
    print(f"TEST RESULTS  |  Loss: {test_metrics['loss']:.4f}  |  AUC: {test_metrics['auc']:.4f}")
    print(test_metrics["report"])
    print(f"{'='*52}\n")

    tokenizer.save_pretrained(cfg.output_dir)
    print(f"Model + tokenizer saved to: {cfg.output_dir}/")


# ─────────────────────────────────────────────────────────────────────────────
# INFERENCE HELPER
# ─────────────────────────────────────────────────────────────────────────────

class ReplyScorerInference:
    """
    Drop-in inference wrapper.

    Usage:
        scorer = ReplyScorerInference("reply_scorer_output/")

        recent_threads = [
            {"thread_id": 7,  "messages": ["[10:31 PM] Sanchit: aa rahe hai", "[10:32 PM] Sanchit: dw"]},
            {"thread_id": 12, "messages": ["[11:15 PM] Manay: [Photo]"]},
        ]
        scores = scorer.score("[11:46 PM] Me: ok", recent_threads)
        # -> [(7, 0.91), (12, 0.04), ...]  sorted descending
    """

    def __init__(self, model_dir, device=None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

        ckpt        = torch.load(Path(model_dir) / "best_model.pt", map_location=self.device, weights_only=False)
        cfg_dict    = ckpt["cfg"]
        self.max_seq_len     = cfg_dict["max_seq_len"]
        self.thread_max_msgs = cfg_dict.get("thread_max_msgs", 10)

        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        self.model     = ThreadReplyScorer(cfg_dict["model_name"]).to(self.device)
        self.model.load_state_dict(ckpt["model_state_dict"])
        self.model.eval()
        print(f"Loaded scorer from '{model_dir}'  (val AUC: {ckpt['val_auc']:.4f})")

    def score(self, candidate_message, threads, batch_size=8):
        """
        Args:
            candidate_message : formatted string, e.g. "[11:46 PM] Me: ok"
            threads           : [{"thread_id": any, "messages": [str, ...]}, ...]
        Returns:
            [(thread_id, score), ...] sorted by score descending
        """
        if not threads:
            return []

        # Heuristic for native quote replies: we won't ask AI to predict if we can resolve it directly
        match = re.search(r"\(Reply to ([^:]+): \\?\"(.*?)\\?\"\)", candidate_message)
        if match:
            quoted_sender = match.group(1).strip()
            quoted_snippet = match.group(2).strip()

            matching_thread_id = None
            for thread in threads:
                for msg_str in thread.get("messages", []):
                    # Parse sender and text from message string: "[10:31 PM] Sanchit: text"
                    msg_match = re.match(r"^\[.*?\] (.*?): (.*)$", msg_str)
                    if msg_match:
                        sender, text = msg_match.group(1).strip(), msg_match.group(2).strip()
                        if sender == quoted_sender:
                            # Match snippet
                            is_match = False
                            if quoted_snippet.endswith("..."):
                                prefix = quoted_snippet[:-3]
                                if text.startswith(prefix):
                                    is_match = True
                            else:
                                if text == quoted_snippet or text.startswith(quoted_snippet):
                                    is_match = True
                            if is_match:
                                matching_thread_id = thread["thread_id"]
                                break
                if matching_thread_id is not None:
                    break

            if matching_thread_id is not None:
                results = []
                for thread in threads:
                    tid = thread["thread_id"]
                    score = 1.0 if tid == matching_thread_id else 0.0
                    results.append((tid, score))
                results.sort(key=lambda x: x[1], reverse=True)
                return results

        results = []
        for i in range(0, len(threads), batch_size):
            batch        = threads[i : i + batch_size]
            thread_texts = [" | ".join(t["messages"][-self.thread_max_msgs:]) for t in batch]

            batch_input_ids = []
            batch_attention_mask = []
            batch_token_type_ids = []

            for t_text in thread_texts:
                inputs = prepare_middle_truncated_input(
                    self.tokenizer,
                    t_text,
                    candidate_message,
                    self.max_seq_len
                )
                batch_input_ids.append(inputs["input_ids"])
                batch_attention_mask.append(inputs["attention_mask"])
                batch_token_type_ids.append(inputs["token_type_ids"])

            input_ids      = torch.stack(batch_input_ids).to(self.device)
            attention_mask = torch.stack(batch_attention_mask).to(self.device)
            token_type_ids = torch.stack(batch_token_type_ids).to(self.device)

            with torch.no_grad():
                scores = self.model(input_ids, attention_mask, token_type_ids)

            for j, thread in enumerate(batch):
                results.append((thread["thread_id"], float(scores[j].item())))

        results.sort(key=lambda x: x[1], reverse=True)
        return results


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train a chat thread reply scorer")
    parser.add_argument("--threads",         type=str,   default="train/threads")
    parser.add_argument("--annotations",     type=str,   default="train/annotations.jsonl")
    parser.add_argument("--output_dir",      type=str,   default="reply_scorer_output")
    parser.add_argument("--model_name",      type=str,   default="bert-base-multilingual-cased")
    parser.add_argument("--epochs",          type=int,   default=5)
    parser.add_argument("--batch_size",      type=int,   default=16)
    parser.add_argument("--max_seq_len",     type=int,   default=512)
    parser.add_argument("--neg_per_pos",     type=int,   default=3)
    parser.add_argument("--thread_max_msgs", type=int,   default=10)
    parser.add_argument("--lr",              type=float, default=2e-5)
    parser.add_argument("--pos_weight",      type=float, default=3.0)
    parser.add_argument("--seed",            type=int,   default=42)
    parser.add_argument("--limit_threads",   type=int,   default=None)
    args = parser.parse_args()

    cfg = Config(
        threads_path=args.threads,
        annotations_path=args.annotations,
        output_dir=args.output_dir,
        model_name=args.model_name,
        epochs=args.epochs,
        batch_size=args.batch_size,
        max_seq_len=args.max_seq_len,
        neg_per_pos=args.neg_per_pos,
        thread_max_msgs=args.thread_max_msgs,
        learning_rate=args.lr,
        pos_weight=args.pos_weight,
        seed=args.seed,
        limit_threads=args.limit_threads,
    )

    train(cfg)