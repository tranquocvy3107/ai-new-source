# AI Agent Backend Base

Source base backend dùng:
- NestJS
- TypeORM
- PostgreSQL
- Docker Compose
- LangChain
- LangGraph
- Llama.cpp (qua `llama-server`)
- RAG (chunk + retrieval base)
- Domain memory (lưu tóm tắt + evidence vào DB)

## 1) Cài đặt

```bash
npm install
cp .env.example .env
```

## 2) Chạy Postgres bằng Docker

```bash
docker compose up -d
```

## 3) Chạy llama-server local

Ví dụ bạn đã có:

```powershell
.\build\bin\Release\llama-server.exe -m models\Qwen3.5-4B-IQ4_XS.gguf --device Vulkan0 --gpu-layers 32 --ctx-size 8192 --alias Qwen3.5-4B
```

Mặc định backend sẽ gọi:
- `LLM_BASE_URL=http://127.0.0.1:8080/v1`
- `LLM_MODEL=Qwen3.5-4B`

## 4) Chạy backend

```bash
npm run start:dev
```

Server mặc định: `http://localhost:5000/api`

## 5) API test model

`POST /api/ai/model/test`

```json
{
  "prompt": "Xin chao model local"
}
```

## 6) API chạy agent

`POST /api/ai/agent/run`

```json
{
  "input": "hay research domain example.com",
  "domain": "example.com",
  "saveMemory": true
}
```

Response trả về gồm:
- `events`: thinking, tool_call, tool_result, final_response
- `finalAnswer`
- `runId` để FE lấy lại lịch sử event

## 7) API lấy stream/history

- Lịch sử event: `GET /api/ai/agent/runs/:runId/events`
- Live SSE: `GET /api/ai/agent/runs/:runId/live`

## Cấu trúc chính

```text
src/
  config/                  # env validation + typeorm datasource
  database/entities/       # run, events, domain memory, chunks
  modules/ai/
    agent/                 # orchestration + langgraph loop
    llm/                   # llama-server client
    tools/                 # url_search, web_scrape, memory_lookup
    memory/                # persistence memory
    rag/                   # chunk + ranking base
    stream/                # live event stream for FE
```

## Ghi chú quan trọng

- `url_search` dùng DuckDuckGo HTML endpoint và đã set các header cần thiết (`User-Agent`, `Accept`, `Accept-Language`, `Referer`, `DNT`, ...).
- Có fallback tự động sang Bing HTML/RSS nếu DuckDuckGo bị anti-bot.
- Có thêm tool `check_connect` để kiểm tra HTTP status (200/403/500/...) trước khi scrape.
- Có thêm tool `semrush_traffic` (cần cookie Semrush đăng nhập) để lấy traffic/authority signals.
- Vector search hiện là base implementation (deterministic embedding nội bộ) để bạn code tiếp sang pgvector hoặc embedding model sau.
- LangGraph loop đã sẵn để phát triển thêm:
  - planner
  - tool execution
  - finalize
  - summary memory update

## Định hướng research affiliate (đã gắn vào prompt agent)

Agent sẽ hướng tới pipeline:
1) Tìm affiliate program của domain
2) Tìm URL liên quan, kiểm tra kết nối URL, scrape URL phù hợp
3) Tìm sản phẩm và giá
4) Tìm commission model
5) Tìm referral link/tracking
6) Thu thập traffic/quality signals (Semrush nếu có)
7) Tạo tiêu chí đánh giá và verdict PASS/FAIL
8) Chuẩn bị data đầu vào cho Google Ads
