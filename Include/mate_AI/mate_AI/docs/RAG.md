# Mate AI RAG Guide

## What is implemented
- Local document ingestion from uploads (text-like files).
- Chunking with overlap for better retrieval quality.
- TF-IDF retrieval over chunk store (fully free, no paid vector DB).
- Top chunk injection into chat prompt before generation.
- Source exposure in UI and response headers.
- Live web-search retrieval (DuckDuckGo HTML search + page snippet extraction).
- Web and local retrieval are both injected as grounding context.

## Supported file types for ingestion
- `.txt`, `.md`, `.json`, `.csv`, `.log`, `.html`, `.xml`

Non-text files (PDF, DOCX, images, audio) are uploaded but not indexed by default.

## API
- `GET /api/rag/status` -> knowledge base source/chunk counts.
- `GET /api/web/search?q=...` -> web retrieval results for debugging.
- `POST /api/chat` -> automatically performs retrieval based on user query.
- `POST /api/upload` -> auto-indexes text-like files into RAG store.

## Commands
- `npm run rag:reindex` -> rebuild KB from files already present in `uploads/`.

## Notes
- RAG store persists at `data/rag_store.json`.
- Current web retrieval is free and keyless, but can be rate-limited by source sites.
- For production scale, next step is swapping TF-IDF retrieval with embeddings + vector DB and adding an official search API provider fallback.
