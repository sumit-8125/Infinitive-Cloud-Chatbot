"""Small, dependency-free local API for the Infinitive Cloud assistant."""

from __future__ import annotations

import json
import math
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
KNOWLEDGE_PATH = ROOT / "knowledge_base.txt"
PORT = int(os.environ.get("CHATBOT_PORT", "8000"))
HOST = os.environ.get("CHATBOT_HOST", "127.0.0.1")
MAX_BODY = 32_000

STOP_WORDS = {
    "about", "after", "also", "and", "are", "can", "could", "did", "does", "for", "from",
    "have", "help", "how", "into", "is", "its", "me", "my", "our", "please", "tell", "that",
    "the", "their", "them", "there", "this", "want", "was", "what", "when", "where", "which",
    "who", "why", "with", "would", "you", "your", "hai", "ka", "ke", "ki", "kya", "mujhe",
    "mein", "mai", "karo", "batao", "chahiye", "krna", "karna", "hai", "or", "aur",
    "need", "recommend", "one", "offer", "please", "tell", "getting", "from", "onto", "do",
    "does", "did", "what", "which", "how", "could", "should", "would", "about", "tell",
    "information", "info", "details", "detail", "we", "our",
    "in", "on", "at", "to", "as", "be", "it", "via", "over", "under", "per", "than",
    "between", "here", "there", "their", "they", "them", "then", "also",
    "liye", "karne", "keeps", "just", "please", "kaunsi", "kaunsa", "konsi", "konsa", "konse",
    "requirement", "requirements", "share", "karni", "hongi", "hoga", "hain", "bata", "kaun",
}


def read_knowledge() -> tuple[str, list[tuple[int, str]]]:
    if not KNOWLEDGE_PATH.exists():
        raise RuntimeError(f"Knowledge file is missing: {KNOWLEDGE_PATH}")
    raw = KNOWLEDGE_PATH.read_text(encoding="utf-8")
    pages: list[tuple[int, str]] = []
    for part in re.split(r"(?=\[PDF page \d+\])", raw):
        match = re.match(r"\[PDF page (\d+)\]\s*\n(.*)", part, re.S)
        if match:
            pages.append((int(match.group(1)), match.group(2).strip()))
    return raw, pages


KNOWLEDGE, PAGES = read_knowledge()


def terms(text: str) -> set[str]:
    return {
        word for word in re.findall(r"[a-z0-9+#]+(?:[.-][a-z0-9+#]+)*", text.lower())
        if word not in STOP_WORDS
    }


def retrieve(query: str, limit: int = 4) -> list[tuple[float, str, int]]:
    query_terms = terms(query)
    if not query_terms:
        return []
    document_frequency: dict[str, int] = {}
    page_term_sets = [terms(page) for _, page in PAGES]
    for page_terms in page_term_sets:
        for term in page_terms:
            document_frequency[term] = document_frequency.get(term, 0) + 1
    scored: list[tuple[float, str, int]] = []
    for page_num, page in PAGES:
        paragraphs = [re.sub(r"\s+", " ", line).strip(" •\t") for line in re.split(r"\n+", page)]
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            if not paragraph:
                continue
            # Keep snippets inside their numbered PDF section; otherwise separate
            # topics on the same page can get merged into one retrieval result.
            is_section_heading = bool(re.match(r"^\d+(?:\.\d+)*\.?\s+[A-Z]", paragraph))
            if current and is_section_heading:
                chunks.append(current)
                current = ""
            if current and len(current) + len(paragraph) > 700:
                chunks.append(current)
                current = ""
            current = f"{current} {paragraph}".strip()
        if current:
            chunks.append(current)
        for paragraph in chunks:
            words = terms(paragraph)
            matches = query_terms & words
            if len(matches) < max(1, math.ceil(len(query_terms) / 2)):
                continue
            score = 0.0
            for word in matches:
                inverse_frequency = math.log(1 + len(PAGES) / (1 + document_frequency.get(word, len(PAGES))))
                score += inverse_frequency * (1 + min(paragraph.lower().count(word), 2) * 0.2)
            if re.match(r"^\d+(?:\.\d+)?\s", paragraph):
                score += 0.4
            scored.append((score, paragraph, page_num))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return []
    # Discard weak lexical matches so a generic word cannot pull in unrelated pages.
    cutoff = max(0.65, scored[0][0] * 0.48)
    selected: list[tuple[int, str, int]] = []
    seen: set[str] = set()
    for item in scored:
        if item[0] < cutoff:
            break
        normalized = item[1].lower()
        if normalized in seen:
            continue
        selected.append(item)
        seen.add(normalized)
        if len(selected) >= limit:
            break
    return selected


def local_reply(query: str, passages: list[tuple[int, str, int]]) -> str:
    if not passages:
        return "I don't have enough information to answer that."
    excerpt = passages[0][1]
    excerpt = re.sub(r"^\d+(?:\.\d+)*\.?\s+", "", excerpt)
    excerpt = re.sub(r"\s+\d+\s*$", "", excerpt)
    excerpt = re.sub(r"\s+", " ", excerpt).strip(" .")
    # Drop an all-caps section title when the actual explanatory text follows.
    excerpt = re.sub(
        r"^[A-Z0-9 &/–—-]{3,80}\s+(?=(?:A|An|The)\s+[A-Z][A-Za-z]+|[A-Z][a-z])",
        "",
        excerpt,
    )
    query_terms = terms(query)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", excerpt) if part.strip()]
    ranked = [
        (len(query_terms & terms(sentence)), index, sentence)
        for index, sentence in enumerate(sentences)
    ]
    relevant = [item for item in ranked if item[0] > 0]
    if relevant:
        best_score = max(item[0] for item in relevant)
        selected = [item for item in relevant if item[0] == best_score][:2]
        answer = " ".join(item[2] for item in sorted(selected, key=lambda item: item[1]))
    else:
        answer = excerpt
    if len(answer) > 600:
        answer = answer[:597].rsplit(" ", 1)[0] + "..."
    return answer


def is_broad_service_query(query: str) -> bool:
    # A one-word "service(s)" request is too vague to rank one specific
    # offering. Return the guide's service menu instead of unrelated snippets.
    normalized = re.sub(r"[^a-z ]", " ", query.lower()).strip()
    words = set(normalized.split())
    allowed = {
        "service", "services", "offer", "offers", "offering", "offerings",
        "provide", "provides", "providing", "company", "cloud", "infinitive",
        "what", "are", "is", "your", "do", "you", "please", "tell", "me",
        "about", "list", "options", "batao", "bata", "chahiye", "kaunsi",
        "kaunsa", "kya", "hai",
    }
    return bool(words & {"service", "services", "offering", "offerings"}) and words <= allowed


def service_menu_reply() -> str:
    section_titles: list[str] = []
    for _, page_text in PAGES:
        for line in page_text.splitlines():
            match = re.match(r"\s*5\.\d+\s+(.+?)\s*$", line)
            if match:
                raw_title = match.group(1).strip(" .")
                raw_words = raw_title.split()
                words = [word for word in raw_words if word.isascii()]
                formatted_words = [
                    word if word in {"VPS", "IP", "SSL"} else word.title()
                    for word in words
                ]
                title = " ".join(formatted_words)
                if len(words) > 2 and raw_words and raw_words[0].isupper() and len(raw_words[0]) <= 3 and any(not word.isascii() for word in raw_words[1:-1]):
                    title = f"{formatted_words[0]} ({' '.join(formatted_words[1:])})"
                section_titles.append(title)
    if not section_titles:
        return "I don't have enough information to answer that."
    return ", ".join(section_titles) + ". Which one would you like to know about?"


class Handler(BaseHTTPRequestHandler):
    server_version = "InfinitiveCloudChat/1.0"

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "Not found"})
            return
        self.send_json(200, {
            "status": "ready",
            "mode": "pdf-only",
        })

    def do_POST(self) -> None:
        if self.path != "/chat":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length."})
            return
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "Request must contain at most 32 KB."})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid JSON request."})
            return
        incoming = body.get("messages") if isinstance(body, dict) else None
        if not isinstance(incoming, list) or not incoming:
            self.send_json(400, {"error": "Send at least one user message."})
            return
        messages = []
        for item in incoming[-10:]:
            if not isinstance(item, dict) or item.get("role") not in ("user", "assistant") or not isinstance(item.get("content"), str):
                self.send_json(400, {"error": "Messages must have user/assistant roles and text content."})
                return
            messages.append({"role": item["role"], "content": item["content"][:1500]})
        user_query = next((item["content"] for item in reversed(messages) if item["role"] == "user"), "")
        if not user_query.strip():
            self.send_json(400, {"error": "The latest user message is empty."})
            return
        if is_broad_service_query(user_query):
            self.send_json(200, {
                "reply": service_menu_reply(),
                "mode": "pdf-only",
            })
            return
        passages = retrieve(user_query, limit=1)
        # Strict source-only mode: factual replies are copied from the PDF
        # knowledge base; a generative model cannot add unsupported claims.
        answer = local_reply(user_query, passages)
        self.send_json(200, {
            "reply": answer,
            "mode": "pdf-only",
        })

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


if __name__ == "__main__":
    print(f"Infinitive Cloud chatbot backend: http://{HOST}:{PORT}")
    print("Answer source: supplied PDF only (extractive mode; LLM not used)")
    print(f"Knowledge pages loaded: {len(PAGES)}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
