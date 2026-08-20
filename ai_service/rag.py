"""本地史料 RAG 索引：不修改网站数据，也不上传原始文件。"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import zipfile
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Callable

try:
    from pypdf import PdfReader
except ImportError:  # 首次安装依赖前仍允许启动服务
    PdfReader = None


INDEX_DIR = Path(__file__).resolve().parent / "rag_index"
DB_PATH = INDEX_DIR / "archive_rag.sqlite3"
CHUNK_SIZE = 900
CHUNK_OVERLAP = 140
MAX_PDF_BYTES = 5 * 1024 * 1024  # 整期扫描本通常没有文字层，避免首次索引长时间卡住


def _connect() -> sqlite3.Connection:
    INDEX_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY, record_id TEXT NOT NULL, title TEXT, source TEXT,
        record_type TEXT, time TEXT, topics TEXT, keywords TEXT, document_path TEXT,
        text TEXT NOT NULL, text_hash TEXT NOT NULL, embedding TEXT
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_record ON chunks(record_id)")
    return conn


def _load_records(data_path: Path) -> list[dict]:
    raw = data_path.read_text(encoding="utf-8")
    match = re.search(r"window\.INITIAL_DATA\s*=\s*(\[.*\])\s*;?\s*$", raw, re.S)
    if not match:
        raise ValueError("无法读取 data/data.js 中的 INITIAL_DATA。")
    return json.loads(match.group(1))


def _read_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as package:
        xml = package.read("word/document.xml").decode("utf-8", errors="ignore")
    paragraphs = re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)
    return "\n".join("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, flags=re.S)) for p in paragraphs)


def _read_pdf(path: Path) -> str:
    if PdfReader is None:
        return ""
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _read_file(path: Path) -> str:
    try:
        if path.suffix.lower() == ".docx":
            return _read_docx(path)
        if path.suffix.lower() == ".pdf":
            if path.stat().st_size > MAX_PDF_BYTES:
                return ""
            return _read_pdf(path)
    except Exception:
        return ""
    return ""


def _chunks(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]
    result, start = [], 0
    while start < len(text):
        end = min(len(text), start + CHUNK_SIZE)
        if end < len(text):
            boundary = max(text.rfind("。", start + 450, end), text.rfind("\n", start + 450, end))
            if boundary > start:
                end = boundary + 1
        result.append(text[start:end].strip())
        start = max(end - CHUNK_OVERLAP, start + 1)
    return result


def _metadata_text(record: dict) -> str:
    topics = "、".join(record.get("topics") or [])
    keywords = "、".join(record.get("keywords") or [])
    opinion_types = "、".join(record.get("opinion_types") or [])
    ai_keywords = "、".join(record.get("ai_keywords") or [])
    clean_text = record.get("clean_text") or record.get("docx_preview_text") or ""
    sections = [
        ("标题", record.get("title", "")),
        ("来源", record.get("source", "")),
        ("时间", record.get("time", "")),
        ("议题", topics),
        ("人工关键词", keywords),
        ("舆论类型", opinion_types),
        ("标准正文", clean_text),
        ("核心内容", record.get("core_content", "")),
        ("个人分析", record.get("personal_analysis", "")),
        ("AI摘要", record.get("ai_summary", "")),
        ("AI关键词", ai_keywords),
        ("AI社会问题", record.get("ai_social_issue", "")),
        ("AI研究价值", record.get("ai_research_value", "")),
        ("AI分类", record.get("ai_category", "")),
        ("AI论文用途", record.get("ai_paper_use", "")),
        ("AI与旗袍设计史关系", record.get("ai_relation", "")),
    ]
    return "\n".join(f"{label}：{str(value).strip()}" for label, value in sections if str(value).strip())


def build_index(data_path: Path, website_root: Path, embed: Callable[[list[str]], list[list[float]]] | None = None) -> dict:
    records = _load_records(data_path)
    rows: list[dict] = []
    for record in records:
        base = _metadata_text(record)
        # 索引只读取数据库中的标准文本、人工标签与分析字段；不读取图片、PDF、
        # OCR 原始文本或外部 DOCX，避免未经复核的文字进入研究问答。
        for text in _chunks(base):
            rows.append({"record": record, "document_path": "", "text": text})

    embeddings: list[list[float] | None] = [None] * len(rows)
    if embed and rows:
        for start in range(0, len(rows), 32):
            batch = [r["text"][:6000] for r in rows[start:start + 32]]
            vectors = embed(batch)
            if len(vectors) != len(batch):
                raise ValueError("向量模型返回数量与待索引文本不一致。")
            embeddings[start:start + len(batch)] = vectors

    with closing(_connect()) as conn:
        conn.execute("DELETE FROM chunks")
        for row, vector in zip(rows, embeddings):
            r = row["record"]
            text = row["text"]
            conn.execute("""INSERT INTO chunks
                (record_id,title,source,record_type,time,topics,keywords,document_path,text,text_hash,embedding)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (
                    r.get("shiliao_id", ""), r.get("title", ""), r.get("source", ""), r.get("type", ""),
                    r.get("time", ""), json.dumps(r.get("topics") or [], ensure_ascii=False),
                    json.dumps(r.get("keywords") or [], ensure_ascii=False), row["document_path"], text,
                    hashlib.sha256(text.encode("utf-8")).hexdigest(), json.dumps(vector) if vector else None,
                ))
        conn.commit()
    return {"records": len(records), "chunks": len(rows), "vectorized": bool(embed), "unreadable_files": 0}


def _terms(question: str) -> list[str]:
    clean = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", question.lower())
    terms = {clean} if clean else set()
    terms.update(clean[i:i + 2] for i in range(max(0, len(clean) - 1)))
    terms.update(part.lower() for part in re.findall(r"[A-Za-z0-9]{2,}", question))
    return [t for t in terms if len(t) >= 2]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    denom = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / denom if denom else 0.0


def search(question: str, limit: int = 8, filters: dict | None = None,
           query_embedding: list[float] | None = None) -> list[dict]:
    filters = filters or {}
    terms = _terms(question)
    with closing(_connect()) as conn:
        candidates = [dict(row) for row in conn.execute("SELECT * FROM chunks")]
    scored = []
    for row in candidates:
        if filters.get("year") and str(filters["year"]) not in row["time"]:
            continue
        match = re.search(r"(?<!\d)(1[6-9]\d{2}|20\d{2})(?!\d)", row["time"] or "")
        item_year = int(match.group(1)) if match else None
        if filters.get("year_from"):
            try:
                if item_year is None or item_year < int(filters["year_from"]):
                    continue
            except ValueError:
                pass
        if filters.get("year_to"):
            try:
                if item_year is None or item_year > int(filters["year_to"]):
                    continue
            except ValueError:
                pass
        if filters.get("topic") and filters["topic"] not in row["topics"]:
            continue
        if filters.get("record_type") and filters["record_type"] != row["record_type"]:
            continue
        haystack = " ".join(str(row[k]).lower() for k in ("title", "source", "topics", "keywords", "text"))
        lexical = sum(haystack.count(term) for term in terms)
        title_bonus = sum(str(row["title"]).lower().count(term) * 2 for term in terms)
        vector_score = 0.0
        if query_embedding and row.get("embedding"):
            vector_score = _cosine(query_embedding, json.loads(row["embedding"]))
        score = lexical + title_bonus + vector_score * 12
        if score:
            row["score"] = round(score, 3)
            row["vector_score"] = round(vector_score, 3)
            scored.append(row)
    scored.sort(key=lambda item: item["score"], reverse=True)
    # 一个史料通常只需要一个最相关片段，避免回答被同一篇长文挤占。
    unique, used = [], set()
    for row in scored:
        key = row["record_id"]
        if key not in used:
            unique.append(row)
            used.add(key)
        if len(unique) >= max(1, min(limit, 12)):
            break
    return unique


def status() -> dict:
    if not DB_PATH.exists():
        return {"indexed": False, "chunks": 0, "vectorized": False}
    with closing(_connect()) as conn:
        count, vectors = conn.execute("SELECT count(*), count(embedding) FROM chunks").fetchone()
    return {"indexed": bool(count), "chunks": count, "vectorized": bool(vectors)}
