"""海派旗袍史料库：仅本机运行的豆包 AI 中间服务。"""

import base64
import io
import json
import os
import re
import socket
import zipfile
from html import escape
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx
from pydantic import BaseModel, Field
import rag

try:
    import pymupdf as fitz  # 将扫描 PDF 的页面渲染成图片后再 OCR
except ImportError:
    fitz = None

try:
    from opencc import OpenCC
except ImportError:
    OpenCC = None

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT.parent / "data" / "data.js"
NOTES_PATH = ROOT / "notes_backup" / "inspiration_notes.json"
load_dotenv(ROOT / ".env")
MAX_FILE_SIZE = 15 * 1024 * 1024
MAX_DRAFT_SIZE = 5 * 1024 * 1024
SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/webp"}
OCR_FILE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".pdf", ".docx"}
MAX_OCR_PAGES = 20

OCR_PROMPT = """你是民国报刊 OCR 助手。

请只识别图片中的文字。

要求：
1. 保留繁体原文；
2. 保留原始段落和阅读顺序，但不要按照报刊栏目的视觉行宽换行；同一语句被栏宽截断时要合并为完整句子；
3. 不翻译；
4. 不总结；
5. 不改写；
6. 无法识别的单个字符标记为□；
7. 多张连续或重叠图片按顺序合并，重叠内容只保留一次。

只输出纯文本，不要使用 Markdown，不要解释。
"""


def normalize_ocr_linebreaks(text: str) -> str:
    """合并报刊栏宽造成的断行，保留空行作为段落边界。"""
    raw_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    paragraphs: list[list[str]] = []
    current: list[str] = []
    sentence_end = re.compile(r"[。！？；：！？」』”’）)】》]$")
    for raw_line in raw_lines:
        line = re.sub(r"[ \t\u3000]+", " ", raw_line).strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = []
            paragraphs.append([])
            continue
        if not current:
            current = [line]
        elif sentence_end.search(current[-1]):
            current.append(line)
        else:
            # 中文报刊正文的栏宽断行通常不需要补空格。
            current[-1] += line
    if current:
        paragraphs.append(current)

    output: list[str] = []
    for paragraph in paragraphs:
        if not paragraph:
            if output and output[-1] != "":
                output.append("")
            continue
        output.extend(paragraph)
    return "\n".join(output).strip()

ANALYSIS_PROMPT = """你是一名严谨的中国近现代设计史研究助手。请只依据用户提供的史料和元数据分析，不得虚构史实、出处或作者意图。区分材料明示内容和研究推论。输出必须是一个 JSON 对象，不要使用 Markdown。

JSON 字段：
{
  "summary": "核心观点，概括材料主张及其论证重点",
  "keywords": ["5至10个具体、可检索的关键词"],
  "social_issue": "材料反映的社会问题，尤其关注性别秩序、身体规范、消费与公共舆论",
  "research_value": "这条材料的史料价值、可证明的问题及使用边界",
  "relation_to_qipao_history": "与海派旗袍设计史的关系",
  "paper_use": "可用于论文的章节、论点或比较位置",
  "highlight_candidates": [
    {"quote": "标准文本中逐字存在的、值得引用的完整片段", "note": "一句话说明该片段可证明的历史问题或史料价值"}
  ]
}
"""

SYSTEM_PROMPT = """你是近代中国社会史、服饰史与消费史研究者，负责整理民国中文报刊史料。请严格依据图片中可辨识的内容工作，不要猜测或补写无法辨认的文字。用户可能提供同一史料的多张连续或重叠截图，请严格按图片顺序合并，重叠内容只保留一次。所有输出均使用简体中文；原文中的繁体字转换为对应简体字，但不得改写、润色或改变原意。输出必须是一个 JSON 对象，不能使用 Markdown。

分析思路应接近历史研究助理的材料卡片：先概括材料事实，再从材料内部证据提炼可供论文讨论的历史问题。重点关注但不限于：国货运动、旗袍与丝织产业、性别与女性消费、儿童消费教育、行业公会与质量认证、商业营销、民族国家话语、城市日常生活。不得为了套用这些主题而脱离材料。

JSON 字段：
{
  "title": "文章或图片题名；无法确认则为空字符串",
  "source": "报纸/刊物名称；无法确认则为空字符串",
  "author": "署名；未见署名则为空字符串",
  "time": "按图片原样转写日期；无法确认则为空字符串",
  "version_info": "版次、期号或页码；无法确认则为空字符串",
  "transcription": "按图片顺序合并的完整简体字原文转录；保留段落换行；重叠处不重复；不确定字符用［？］标记",
  "keywords": ["5至10个尽量具体、可检索、能够概括材料对象与机制的关键词"],
  "core_content": "材料重点总结：先用一句话交代时间、来源、事件与主体，再用1. 2. 3.形式列出3至6项关键事实；每项先给简短概括，再说明材料依据。",
  "research_analysis": "材料体现的核心历史问题：用1. 2. 3.形式提炼2至5个可供论文讨论的问题。每项先写一个明确判断句，再用一两句解释证据链和历史意义；区分材料明示与研究推论，避免空泛套话。",
  "highlight_candidates": [
    {"quote": "值得高亮的原文，必须逐字存在于transcription中", "note": "一句话批注：说明这段原文揭示的机制、观念或史料价值"}
  ]
}

高亮选择标准：选择4至8段具有独立证据价值、可直接引用的原文，而不是只选孤立名词。优先选择能证明行动主体、制度机制、营销办法、消费群体、价值话语、数量规模、因果关系或社会反应的句子。quote必须与transcription中的简体字、标点和换行完全一致，禁止摘要改写；note只写一句，解释“这句话能证明什么”，不要复述原文。
"""


class AnalysisResult(BaseModel):
    title: str = ""
    source: str = ""
    author: str = ""
    time: str = ""
    version_info: str = ""
    transcription: str = ""
    keywords: list[str] = []
    core_content: str = ""
    research_analysis: str = ""
    highlight_candidates: list[dict[str, str]] = []


class DocxExportRequest(BaseModel):
    title: str = "史料原文"
    text: str


class DataExportRequest(BaseModel):
    records: list[dict]


class RagBuildRequest(BaseModel):
    use_embeddings: bool = False


class RagAskRequest(BaseModel):
    question: str
    mode: str = "ask"  # ask | compare | thesis | outline
    record_ids: list[str] = []
    year: str = ""
    year_from: str = ""
    year_to: str = ""
    topic: str = ""
    record_type: str = ""
    limit: int = 8


class NotesSyncRequest(BaseModel):
    notes: list[dict]


class ConvertRequest(BaseModel):
    text: str


class AnalyzeRequest(BaseModel):
    text: str
    year: str = ""
    topic: str = ""
    source: str = ""
    title: str = ""


class StructuredAnalysisResult(BaseModel):
    summary: str = ""
    keywords: list[str] = Field(default_factory=list)
    social_issue: str = ""
    research_value: str = ""
    relation_to_qipao_history: str = ""
    paper_use: str = ""
    highlight_candidates: list[dict[str, str]] = Field(default_factory=list)


app = FastAPI(title="Qipao Archive AI Service", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_config() -> tuple[str, str]:
    api_key = os.getenv("ARK_API_KEY", "").strip()
    model = os.getenv("ARK_MODEL", "").strip()
    if not is_configured(api_key, model):
        raise HTTPException(status_code=503, detail="豆包尚未配置。请将 ai_service/.env.example 复制为 .env，并填入 ARK_API_KEY 与 ARK_MODEL。")
    return api_key, model


def is_configured(api_key: str, model: str) -> bool:
    return bool(api_key and model and "请粘贴" not in api_key and "请粘贴" not in model)


def get_proxy() -> str | None:
    """优先使用显式代理；Clash Verge 运行时自动使用其默认混合端口。"""
    configured_proxy = (
        os.getenv("ARK_PROXY", "").strip()
        or os.getenv("HTTPS_PROXY", "").strip()
        or os.getenv("HTTP_PROXY", "").strip()
    )
    if configured_proxy:
        return configured_proxy
    try:
        with socket.create_connection(("127.0.0.1", 7897), timeout=0.2):
            return "http://127.0.0.1:7897"
    except OSError:
        return None


def parse_json(content: str) -> dict:
    """容错处理模型偶尔附带的 Markdown 代码块。"""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="豆包未返回可解析的结构化结果，请重试。") from exc


def normalize_analysis_result(result: dict) -> dict:
    """兼容模型把应为段落的字段返回为字符串数组的情况。"""
    result = dict(result or {})
    for field in ("title", "source", "author", "time", "version_info", "transcription", "core_content", "research_analysis"):
        value = result.get(field, "")
        if isinstance(value, list):
            result[field] = "\n".join(
                f"{index}. {item}" if field in {"core_content", "research_analysis"} else str(item)
                for index, item in enumerate(value, start=1)
            )
        elif value is None:
            result[field] = ""
        elif not isinstance(value, str):
            result[field] = str(value)
    if isinstance(result.get("keywords"), str):
        result["keywords"] = [item.strip() for item in re.split(r"[,，、;；\\n]+", result["keywords"]) if item.strip()]
    return result


def extract_docx_bytes(data: bytes) -> str:
    """提取 DOCX 正文，保留段落；不调用模型，不改写文字。"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            xml = package.read("word/document.xml").decode("utf-8", errors="ignore")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=422, detail="无法读取 DOCX 正文，请确认文件没有损坏。") from exc
    paragraphs = re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)
    text = "\n".join(
        "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", paragraph, flags=re.S))
        for paragraph in paragraphs
    ).strip()
    if not text:
        raise HTTPException(status_code=422, detail="DOCX 中没有可读取的正文。")
    return text


def render_pdf_images(data: bytes, filename: str) -> list[tuple[str, bytes]]:
    """将扫描 PDF 页面转换为 PNG，供视觉模型逐页识别。"""
    if fitz is None:
        raise HTTPException(status_code=503, detail="PDF OCR 组件尚未安装，请重新运行启动AI服务.bat。")
    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"无法打开 PDF「{filename}」。") from exc
    try:
        if document.page_count > MAX_OCR_PAGES:
            raise HTTPException(status_code=413, detail=f"PDF「{filename}」超过 {MAX_OCR_PAGES} 页，请拆分后识别。")
        images = []
        matrix = fitz.Matrix(1.8, 1.8)
        for page_number in range(document.page_count):
            pixmap = document.load_page(page_number).get_pixmap(matrix=matrix, alpha=False)
            images.append((f"{filename} 第 {page_number + 1} 页", pixmap.tobytes("png")))
        return images
    finally:
        document.close()


def normalize_structured_analysis(result: dict) -> dict:
    result = dict(result or {})
    string_fields = ("summary", "social_issue", "research_value", "relation_to_qipao_history", "paper_use")
    for field in string_fields:
        value = result.get(field, "")
        if isinstance(value, list):
            value = "\n".join(str(item) for item in value)
        result[field] = "" if value is None else str(value).strip()
    keywords = result.get("keywords", [])
    if isinstance(keywords, str):
        keywords = re.split(r"[,，、;；\n]+", keywords)
    result["keywords"] = [str(item).strip() for item in keywords if str(item).strip()]
    candidates = result.get("highlight_candidates", [])
    if not isinstance(candidates, list):
        candidates = []
    normalized_candidates = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "") or "").strip()
        note = str(item.get("note", "") or "").strip()
        if quote and note:
            normalized_candidates.append({"quote": quote, "note": note})
    result["highlight_candidates"] = normalized_candidates
    return result


def standardize_text(text: str) -> str:
    """繁转简并做可复核的基础排版；不使用生成式 AI。"""
    if OpenCC is None:
        raise HTTPException(status_code=503, detail="OpenCC 尚未安装，请重新运行启动AI服务.bat。")
    converted = OpenCC("t2s").convert(text.replace("\r\n", "\n").replace("\r", "\n"))
    lines = [re.sub(r"[ \t\u3000]+", " ", line).strip() for line in converted.split("\n")]
    cleaned = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


@app.get("/health")
def health():
    configured = is_configured(os.getenv("ARK_API_KEY", "").strip(), os.getenv("ARK_MODEL", "").strip())
    chat_configured = is_configured(os.getenv("DEEPSEEK_API_KEY", "").strip(), os.getenv("DEEPSEEK_MODEL", "").strip())
    return {"ok": True, "configured": configured, "chat_configured": chat_configured, "proxy": bool(get_proxy())}


@app.post("/api/ocr")
async def ocr_files(files: list[UploadFile] = File(...)):
    """阶段一：图片/扫描 PDF 只做 OCR；DOCX 只提取原文。"""
    if not files or len(files) > 10:
        raise HTTPException(status_code=400, detail="请上传 1 至 10 个图片、PDF 或 DOCX 文件。")
    suffixes = [Path(file.filename or "").suffix.lower() for file in files]
    if ".docx" in suffixes and any(suffix != ".docx" for suffix in suffixes):
        raise HTTPException(status_code=400, detail="DOCX 请单独处理；图片与 PDF 可以按顺序组合识别。")

    image_parts: list[dict] = []
    extracted_texts: list[str] = []
    total_size = 0
    image_number = 0
    for file_number, file in enumerate(files, start=1):
        filename = Path(file.filename or f"文件{file_number}").name
        suffix = Path(filename).suffix.lower()
        if suffix not in OCR_FILE_SUFFIXES:
            raise HTTPException(status_code=415, detail=f"不支持文件「{filename}」，请使用 JPG、PNG、WebP、PDF 或 DOCX。")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"文件「{filename}」内容为空。")
        total_size += len(content)
        if len(content) > 50 * 1024 * 1024 or total_size > 80 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="单个文件不能超过 50MB，全部文件不能超过 80MB。")
        if suffix == ".docx":
            extracted_texts.append(extract_docx_bytes(content))
            continue
        images = render_pdf_images(content, filename) if suffix == ".pdf" else [(filename, content)]
        if image_number + len(images) > MAX_OCR_PAGES:
            raise HTTPException(status_code=413, detail=f"本次图片与 PDF 页面合计超过 {MAX_OCR_PAGES} 页，请分批识别。")
        for label, image_data in images:
            image_number += 1
            mime = "image/png" if suffix == ".pdf" else (file.content_type or "image/jpeg")
            data_url = f"data:{mime};base64,{base64.b64encode(image_data).decode('ascii')}"
            image_parts.extend([
                {"type": "text", "text": f"第 {image_number} 张（{label}）："},
                {"type": "image_url", "image_url": {"url": data_url}},
            ])

    if image_parts:
        api_key, model = get_config()
        request_body = {
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": OCR_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": f"请按顺序识别以下 {image_number} 张图片，只返回繁体原文纯文本。"},
                    *image_parts,
                ]},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=180, proxy=get_proxy()) as client:
                response = await client.post(
                    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=request_body,
                )
            if response.is_error:
                raise HTTPException(status_code=502, detail=f"豆包 OCR 调用失败：{response.text[:300]}")
            ocr_text = (response.json()["choices"][0]["message"]["content"] or "").strip()
            ocr_text = re.sub(r"^```(?:text)?\s*|\s*```$", "", ocr_text, flags=re.IGNORECASE)
            if ocr_text:
                extracted_texts.append(normalize_ocr_linebreaks(ocr_text))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"豆包 OCR 调用失败：{exc}") from exc

    return {"text": "\n\n".join(normalize_ocr_linebreaks(text) for text in extracted_texts if text.strip()).strip()}


@app.post("/api/convert")
def convert_text(payload: ConvertRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="请先提供 OCR 原始文本。")
    if len(text) > 500_000:
        raise HTTPException(status_code=413, detail="文本过长，请分段整理。")
    return {"text": standardize_text(text)}


@app.post("/api/analyze", response_model=StructuredAnalysisResult)
async def analyze_clean_text(payload: AnalyzeRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="请先提供整理后的标准文本。")
    if len(text) > 300_000:
        raise HTTPException(status_code=413, detail="文本过长，请分段分析。")
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    model = os.getenv("DEEPSEEK_MODEL", "").strip()
    if not is_configured(api_key, model):
        raise HTTPException(status_code=503, detail="请先在 ai_service/.env 配置 DEEPSEEK_API_KEY 与 DEEPSEEK_MODEL。")
    metadata = "\n".join([
        f"题名：{payload.title.strip() or '未填写'}",
        f"年份/时间：{payload.year.strip() or '未填写'}",
        f"议题：{payload.topic.strip() or '未填写'}",
        f"来源：{payload.source.strip() or '未填写'}",
    ])
    body = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": ANALYSIS_PROMPT},
            {"role": "user", "content": f"【元数据】\n{metadata}\n\n【史料】\n{text}"},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120, proxy=get_proxy()) as client:
            base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{response.text[:300]}")
        message = response.json()["choices"][0]["message"]["content"]
        result = normalize_structured_analysis(parse_json(message or ""))
        return StructuredAnalysisResult(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{exc}") from exc


def embed_texts(texts: list[str]) -> list[list[float]]:
    """调用火山方舟 OpenAI 兼容 embeddings 接口；仅在用户启用向量索引时使用。"""
    api_key = os.getenv("ARK_API_KEY", "").strip()
    model = os.getenv("ARK_EMBEDDING_MODEL", "").strip()
    if not is_configured(api_key, model):
        raise HTTPException(status_code=503, detail="未配置 ARK_EMBEDDING_MODEL，无法建立向量索引。")
    try:
        with httpx.Client(timeout=120, proxy=get_proxy()) as client:
            response = client.post(
                "https://ark.cn-beijing.volces.com/api/v3/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": texts},
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"向量模型调用失败：{response.text[:300]}")
        values = response.json().get("data", [])
        return [item["embedding"] for item in sorted(values, key=lambda item: item.get("index", 0))]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"向量模型调用失败：{exc}") from exc


def ask_model(question: str, mode: str, sources: list[dict], draft_text: str = "") -> str:
    """用 DeepSeek 生成回答；豆包仅承担向量模型和原有图片识别。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    model = os.getenv("DEEPSEEK_MODEL", "").strip()
    if not is_configured(api_key, model):
        raise HTTPException(status_code=503, detail="请在 ai_service/.env 配置 DEEPSEEK_API_KEY 与 DEEPSEEK_MODEL 后再让 AI 生成研究回答。")
    context = "\n\n".join(
        f"[S{index}] 编号：{item['record_id']}｜题名：{item['title']}｜时间：{item['time']}｜来源：{item['source']}｜议题：{item['topics']}\n{item['text'][:2200]}"
        for index, item in enumerate(sources, start=1)
    )
    instructions = {
        "compare": "比较这些已选史料的共同主题、差异、时间演变和论文价值。",
        "thesis": "评估研究题目的材料支持度、已有材料的优势、缺口和可操作的缩小建议。",
        "outline": "据此生成可检验的论文论证与章节框架，区分可由材料支持的判断与待补材料。若附有论文草稿，必须额外按‘现有论点、可补入的史料、论证薄弱处、可直接调整的章节结构’四部分诊断。",
    }.get(mode, "回答研究问题，先给直接结论，再按论点组织材料证据。")
    system = """你是严谨的近代中国服饰史研究助理。只能依据提供的本地史料回答；不得编造史实、原文、日期或未检索到的材料。每一个事实判断后均用 [S1] 形式标出来源。资料不足时必须明确写‘现有检索材料不足以判断’，并说明还需何种材料。将‘个人分析’视为研究者笔记，不得把它当作史料原文。使用简体中文，语气克制、可供论文工作使用。"""
    draft_context = ""
    if draft_text:
        draft_context = f"\n\n用户上传的论文草稿（仅用于诊断论证；其中陈述并非自动成立的史实证据）：\n{draft_text[:50000]}"
    body = {"model": model, "temperature": 0.2, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": f"任务：{instructions}\n\n问题：{question}\n\n检索到的材料：\n{context}{draft_context}"},
    ]}
    try:
        with httpx.Client(timeout=120, proxy=get_proxy()) as client:
            base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
            response = client.post(f"{base_url}/chat/completions", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=body)
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{response.text[:300]}")
        return response.json()["choices"][0]["message"]["content"].strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{exc}") from exc


@app.get("/rag/status")
def rag_status():
    return {**rag.status(), "embedding_configured": is_configured(os.getenv("ARK_API_KEY", "").strip(), os.getenv("ARK_EMBEDDING_MODEL", "").strip())}


@app.get("/notes/load")
def load_inspiration_notes():
    """读取 AI 助手的本机便签备份；不存在时返回空列表。"""
    if not NOTES_PATH.exists():
        return {"notes": []}
    try:
        payload = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
        notes = payload.get("notes", []) if isinstance(payload, dict) else []
        return {"notes": notes if isinstance(notes, list) else []}
    except (OSError, json.JSONDecodeError):
        return {"notes": []}


@app.post("/notes/sync")
def sync_inspiration_notes(payload: NotesSyncRequest):
    """原子写入本机便签备份，不写入史料 data.js。"""
    if len(payload.notes) > 100:
        raise HTTPException(status_code=400, detail="便签最多保存 100 条。")
    content = json.dumps({"version": 1, "updated_at": __import__('datetime').datetime.now().astimezone().isoformat(), "notes": payload.notes}, ensure_ascii=False, indent=2)
    if len(content.encode("utf-8")) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="便签备份不能超过 5MB。")
    try:
        NOTES_PATH.parent.mkdir(exist_ok=True)
        temp_path = NOTES_PATH.with_suffix(".json.tmp")
        temp_path.write_text(content, encoding="utf-8", newline="\n")
        temp_path.replace(NOTES_PATH)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"无法保存便签备份：{exc}") from exc
    return {"ok": True, "count": len(payload.notes), "path": str(NOTES_PATH)}


@app.post("/rag/build")
def rag_build(payload: RagBuildRequest):
    if payload.use_embeddings and not is_configured(os.getenv("ARK_API_KEY", "").strip(), os.getenv("ARK_EMBEDDING_MODEL", "").strip()):
        raise HTTPException(status_code=400, detail="勾选向量检索前，请先在 .env 配置 ARK_EMBEDDING_MODEL。")
    return rag.build_index(DATA_PATH, ROOT.parent, embed_texts if payload.use_embeddings else None)


def answer_rag(question: str, mode: str, record_ids: list[str], limit: int, filters: dict, draft_text: str = "") -> dict:
    question = question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="请输入研究问题。")
    current = rag.status()
    if not current["indexed"]:
        raise HTTPException(status_code=409, detail="尚未建立 AI 索引，请先点击‘建立索引’。")
    query_vector = embed_texts([question])[0] if current["vectorized"] else None
    sources = rag.search(question, limit, filters, query_vector)
    if record_ids:
        selected = set(record_ids)
        sources = [item for item in sources if item["record_id"] in selected]
    if not sources:
        return {"answer": "没有检索到足以回答该问题的本地材料。请放宽筛选条件，或补充原文与标签。", "sources": []}
    return {"answer": ask_model(question, mode, sources, draft_text), "sources": [
        {key: item[key] for key in ("record_id", "title", "source", "time", "topics", "document_path", "score", "vector_score")} for item in sources
    ]}


@app.post("/rag/ask")
def rag_ask(payload: RagAskRequest):
    return answer_rag(payload.question, payload.mode, payload.record_ids, payload.limit, {
        "year": payload.year.strip(), "year_from": payload.year_from.strip(), "year_to": payload.year_to.strip(),
        "topic": payload.topic.strip(), "record_type": payload.record_type.strip(),
    })


async def extract_draft_text(draft: UploadFile) -> str:
    name = Path(draft.filename or "").name
    suffix = Path(name).suffix.lower()
    if suffix not in {".docx", ".txt", ".md"}:
        raise HTTPException(status_code=415, detail="论文草稿仅支持 DOCX、TXT 或 Markdown（.md）文件。")
    data = await draft.read()
    if not data:
        raise HTTPException(status_code=400, detail="上传的论文草稿为空。")
    if len(data) > MAX_DRAFT_SIZE:
        raise HTTPException(status_code=413, detail="论文草稿不能超过 5MB。")
    try:
        if suffix == ".docx":
            with zipfile.ZipFile(io.BytesIO(data)) as package:
                xml = package.read("word/document.xml").decode("utf-8", errors="ignore")
            paragraphs = re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)
            text = "\n".join("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", paragraph, flags=re.S)) for paragraph in paragraphs)
        else:
            text = data.decode("utf-8-sig")
    except (UnicodeDecodeError, KeyError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=422, detail="无法读取草稿内容。请另存为 DOCX、UTF-8 TXT 或 Markdown 后重试。") from exc
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        raise HTTPException(status_code=422, detail="草稿中没有可读取的文字。")
    return text


@app.post("/rag/ask-with-draft")
async def rag_ask_with_draft(
    question: str = Form(...), mode: str = Form("outline"), year_from: str = Form(""), year_to: str = Form(""),
    topic: str = Form(""), draft: UploadFile = File(...),
):
    if mode != "outline":
        raise HTTPException(status_code=400, detail="论文草稿仅用于‘生成论证框架’功能。")
    draft_text = await extract_draft_text(draft)
    return answer_rag(question, mode, [], 8, {"year_from": year_from.strip(), "year_to": year_to.strip(), "topic": topic.strip()}, draft_text)


@app.post("/analyze", response_model=AnalysisResult)
async def analyze_image(files: list[UploadFile] = File(...)):
    if not files or len(files) > 10:
        raise HTTPException(status_code=400, detail="请上传 1 至 10 张图片。")

    image_parts = []
    total_size = 0
    for index, file in enumerate(files, start=1):
        if file.content_type not in SUPPORTED_TYPES:
            raise HTTPException(status_code=415, detail=f"第 {index} 张不是支持的 JPG、PNG 或 WebP 图片。")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"第 {index} 张图片内容为空。")
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"第 {index} 张图片超过 15 MB。")
        total_size += len(content)
        if total_size > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="全部图片总大小不能超过 50 MB。")
        data_url = f"data:{file.content_type};base64,{base64.b64encode(content).decode('ascii')}"
        image_parts.extend([
            {"type": "text", "text": f"第 {index} 张图片："},
            {"type": "image_url", "image_url": {"url": data_url}},
        ])

    api_key, model = get_config()
    request_body = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": f"请按顺序识别并分析以下 {len(files)} 张民国报刊/史料图片，合并原文并转换为简体中文。"},
                *image_parts,
            ]},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120, proxy=get_proxy()) as client:
            response = await client.post(
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"豆包调用失败：{response.text[:300]}")
        message = response.json()["choices"][0]["message"]["content"]
        result = normalize_analysis_result(parse_json(message or ""))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"豆包调用失败：{str(exc)}") from exc

    result["keywords"] = [str(item).strip() for item in result.get("keywords", []) if str(item).strip()]
    return AnalysisResult(**result)


@app.post("/analyze-text", response_model=AnalysisResult)
async def analyze_text(text: str = Form(...)):
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="DOCX 中没有可分析的文字。")
    if len(text) > 300_000:
        raise HTTPException(status_code=413, detail="DOCX 文字过长，请分段分析。")
    api_key, model = get_config()
    request_body = {
        "model": model, "temperature": 0.1, "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"请根据以下已经转换为简体中文的 DOCX 史料原文，完成题名、来源、时间、关键词、材料重点、核心历史问题和高亮原文建议。不要再次改写原文，严格依据文本分析：\n\n{text}"},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120, proxy=get_proxy()) as client:
            response = await client.post(
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"}, json=request_body,
            )
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"豆包调用失败：{response.text[:300]}")
        message = response.json()["choices"][0]["message"]["content"]
        result = normalize_analysis_result(parse_json(message or ""))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"豆包调用失败：{str(exc)}") from exc
    result["keywords"] = [str(item).strip() for item in result.get("keywords", []) if str(item).strip()]
    return AnalysisResult(**result)


@app.post("/export-docx")
def export_docx(payload: DocxExportRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="没有可导出的原文。")
    title = payload.title.strip() or "史料原文"
    document = build_docx(title, text)
    safe_name = re.sub(r'[\\/:*?"<>|]+', "_", title).strip(" .")[:80] or "史料原文"
    return Response(
        content=document,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="transcription.docx"; filename*=UTF-8\'\'{quote(safe_name)}.docx'},
    )


@app.post("/export-data")
def export_data(payload: DataExportRequest):
    """将本地网页汇总的数据原子替换到 shiliao_website/data/data.js。"""
    if not isinstance(payload.records, list):
        raise HTTPException(status_code=400, detail="导出数据格式不正确。")
    content = (
        "// 民国海派旗袍史料库 - 数据\n"
        f"// 导出时间: {__import__('datetime').datetime.now().astimezone().isoformat()}\n"
        f"// 共 {len(payload.records)} 条记录\n\n"
        f"window.INITIAL_DATA = {json.dumps(payload.records, ensure_ascii=False, indent=2)};\n"
    )
    temp_path = DATA_PATH.with_suffix(".js.tmp")
    try:
        temp_path.write_text(content, encoding="utf-8", newline="\n")
        temp_path.replace(DATA_PATH)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"无法写入 data.js：{exc}") from exc
    return {"ok": True, "path": str(DATA_PATH), "count": len(payload.records)}


def build_docx(title: str, text: str) -> bytes:
    """仅用标准库生成可由 Word 打开的最小 DOCX。"""
    def paragraph(value: str, style: str | None = None) -> str:
        style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        lines = value.split("\n")
        runs = "<w:br/>".join(f'<w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r>' for line in lines)
        return f"<w:p>{style_xml}{runs}</w:p>"

    body = paragraph(title, "Title") + "".join(paragraph(line) for line in text.split("\n"))
    document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'''
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'''
    root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
    doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>'''
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document_xml)
        archive.writestr("word/_rels/document.xml.rels", doc_rels)
        archive.writestr("word/styles.xml", styles)
    return output.getvalue()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
