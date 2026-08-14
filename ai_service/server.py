"""海派旗袍史料库：仅本机运行的豆包 AI 中间服务。"""

import base64
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
MAX_FILE_SIZE = 15 * 1024 * 1024
SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/webp"}

SYSTEM_PROMPT = """你是民国中文报刊史料整理助手。请严格依据图片中可辨识的内容工作，不要猜测或补写无法辨认的文字。繁体字保持原貌。输出必须是一个 JSON 对象，不能使用 Markdown。

JSON 字段：
{
  "title": "文章或图片题名；无法确认则为空字符串",
  "source": "报纸/刊物名称；无法确认则为空字符串",
  "author": "署名；未见署名则为空字符串",
  "time": "按图片原样转写日期；无法确认则为空字符串",
  "version_info": "版次、期号或页码；无法确认则为空字符串",
  "transcription": "尽可能完整的原文转录；段落换行；不确定字符用［？］标记",
  "keywords": ["3至8个关键词"],
  "core_content": "客观概括这条史料的主要内容，不虚构。",
  "research_analysis": "结合海派旗袍、服饰史、性别、消费或近代城市文化研究说明可能的研究价值；证据不足时明确说明。"
}
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
    return {"ok": True, "configured": configured}


@app.post("/analyze", response_model=AnalysisResult)
async def analyze_image(file: UploadFile = File(...)):
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=415, detail="请上传 JPG、PNG 或 WebP 图片。")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="没有读取到图片内容。")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="图片不能超过 15 MB。")

    api_key, model = get_config()
    data_url = f"data:{file.content_type};base64,{base64.b64encode(content).decode('ascii')}"
    request_body = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": "请识别并分析这张民国报刊/史料图片。"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
