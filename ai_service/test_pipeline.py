import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import rag
import server


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(server.app)

    def test_convert_uses_opencc_and_preserves_paragraphs(self):
        response = self.client.post("/api/convert", json={"text": "近來滬上盛行旗袍\n\n婦女服飾"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "近来沪上盛行旗袍\n\n妇女服饰")

    def test_docx_ocr_extracts_original_text_without_model(self):
        document = server.build_docx("测试", "近來滬上盛行旗袍")
        response = self.client.post(
            "/api/ocr",
            files={"files": ("史料.docx", document, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("近來滬上盛行旗袍", response.json()["text"])

    def test_pdf_pages_can_be_rendered_for_ocr(self):
        document = server.fitz.open()
        document.new_page().insert_text((72, 72), "OCR test")
        data = document.tobytes()
        document.close()
        images = server.render_pdf_images(data, "test.pdf")
        self.assertEqual(len(images), 1)
        self.assertTrue(images[0][1].startswith(b"\x89PNG"))

    def test_analysis_requires_deepseek_configuration(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "", "DEEPSEEK_MODEL": ""}):
            response = self.client.post("/api/analyze", json={"text": "近来沪上盛行旗袍"})
        self.assertEqual(response.status_code, 503)

    def test_rag_uses_clean_text_and_never_ocr_original(self):
        card = rag._metadata_text({
            "title": "测试史料",
            "clean_text": "人工复核后的标准正文",
            "ocr_original": "未经复核的錯誤原文",
            "document_paths": ["files/raw.pdf"],
            "topics": ["性别议题"],
            "ai_summary": "AI摘要",
            "personal_analysis": "人工分析",
        })
        self.assertIn("人工复核后的标准正文", card)
        self.assertIn("AI摘要", card)
        self.assertIn("人工分析", card)
        self.assertNotIn("未經復核", card)
        self.assertNotIn("raw.pdf", card)

    def test_rag_build_does_not_read_linked_files(self):
        record = {
            "shiliao_id": "SL-TEST-001",
            "title": "测试史料",
            "clean_text": "标准正文",
            "ocr_original": "不应进入索引",
            "document_paths": ["files/raw.docx"],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_path = root / "data.js"
            data_path.write_text(f"window.INITIAL_DATA = {json.dumps([record], ensure_ascii=False)};", encoding="utf-8")
            with patch.object(rag, "INDEX_DIR", root / "index"), patch.object(rag, "DB_PATH", root / "index" / "rag.sqlite3"):
                result = rag.build_index(data_path, root)
                connection = rag._connect()
                try:
                    indexed_text = "\n".join(row[0] for row in connection.execute("SELECT text FROM chunks"))
                finally:
                    connection.close()
        self.assertEqual(result["unreadable_files"], 0)
        self.assertIn("标准正文", indexed_text)
        self.assertNotIn("不应进入索引", indexed_text)
        self.assertNotIn("raw.docx", indexed_text)


if __name__ == "__main__":
    unittest.main()
