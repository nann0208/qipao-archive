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
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT.parent / "data" / "data.js"
load_dotenv(ROOT / ".env")
MAX_FILE_SIZE = 15 * 1024 * 1024
SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/webp"}

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


@app.get("/health")
def health():
    configured = is_configured(os.getenv("ARK_API_KEY", "").strip(), os.getenv("ARK_MODEL", "").strip())
    return {"ok": True, "configured": configured, "proxy": bool(get_proxy())}


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
        result = parse_json(message or "")
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
