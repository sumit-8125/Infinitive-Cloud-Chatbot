# Infinitive Cloud Assistant

A knowledge-grounded chatbot with a Next.js web app and a Python backend. The backend searches a local knowledge file first, then optionally asks an OpenRouter model to write a concise answer from the matching passages.

## 1. How the chatbot is built

The chatbot has four parts:

1. **Chat interface** — The browser renders the conversation, accepts messages, and calls the app's chat API. It stores the most recent 60 messages and the selected theme in that browser's `localStorage`; there is no chat database on the server.
2. **Next.js API proxy** — A server-side route receives browser requests and forwards them to the Python backend. The browser never needs to know the backend's private Docker address or hold the OpenRouter key.
3. **Knowledge retrieval** — The backend searches `backend/knowledge_base.txt`. The file is divided into numbered page sections and paragraphs. Term overlap and inverse-document-frequency weighting rank matching passages; up to three passages are selected. This is lexical search, not a vector database or embedding search.
4. **Optional model response** — If `OPENROUTER_API_KEY` is configured and retrieval finds passages, the backend sends the latest user question and those passages to the configured OpenRouter model. The system prompt instructs the model to use only the supplied excerpts and to say when the evidence is insufficient. The model endpoint is `${OPENROUTER_BASE_URL}/chat/completions`.

If the key is absent, no passage matches, or model inference fails, the backend uses a local answer based on the retrieved text. A broad question about the available services is answered from the knowledge file's service headings.

The backend accepts recent conversation messages, but currently uses only the latest user message as the search query and model prompt. Earlier turns are not sent to OpenRouter as conversational context. When a key is configured, the latest question and retrieved excerpts leave this server and are sent to the configured model provider.

## 2. Technology used

| Area | Technology | Role |
| --- | --- | --- |
| Web app and API proxy | Next.js 16 App Router, React 19, TypeScript | Serves the chat UI and the `/api/chat` route handler. |
| Chat UI | React client component, browser `localStorage` | Manages chat interactions, theme, local history, and backend status display. |
| Backend API | Python 3.12 standard library | Provides `/health` and `/chat`, validates requests, retrieves passages, and calls the model provider. |
| Model access | OpenRouter chat completions API | Routes inference to the model configured by `OPENROUTER_MODEL`. |
| Packaging and deployment | Docker, Docker Compose | Builds and runs the web and backend services as separate containers. |
| Knowledge source | `backend/knowledge_base.txt` | Text used as evidence for retrieval and answers. |

The Python backend currently has no third-party package dependencies. `requirements.txt` is retained for Python packages if they are added later.

## 3. Deploy with Docker Compose

The repository's standard deployment runs on an Ubuntu VM with Docker Engine and the Compose plugin installed. Run the app on a VM, not on the Proxmox host. Place a reverse proxy with HTTPS in front of the web service for public access.

Copy or clone the project onto the VM. From the project directory, create the private environment file and add an OpenRouter key if model answers are wanted:

```bash
cp -n .env.example .env
nano .env
```

Keep the populated `.env` file private. It is ignored by Git and its API key is passed only to the backend container. Without a key, local knowledge-base answers are still available.

Build and start both services:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f
```

The app is available at `http://<VM-IP>:3000` for a direct check. For production, have the reverse proxy forward traffic to port 3000 and handle TLS. Compose waits for the backend health check before starting the web service; both containers use `restart: unless-stopped`.

### Deployment operations

```bash
# Check backend health from inside its container
docker compose exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"

# View service logs
docker compose logs -f web
docker compose logs -f backend

# Recreate services after changing environment values
docker compose up -d

# Rebuild after changing code or the knowledge file
docker compose up --build -d

# Stop and remove containers and the Compose network
docker compose down
```

There are no named volumes or backend records to back up. Chat history is stored in each user's browser. The knowledge file is copied into the backend image at build time, so rebuild after editing it. The backend needs outbound network access to the configured OpenRouter endpoint when model inference is enabled.

### Run the containers without Compose

Compose is a convenience for creating the network and starting both containers together. To run them manually, first create `.env` as above, then from the project root:

```bash
docker network create infinitive-chatbot-net

docker build -t infinitive-backend -f backend/Dockerfile .
docker build -t infinitive-web -f Dockerfile .

docker run -d \
  --name chatbot-backend \
  --network infinitive-chatbot-net \
  --restart unless-stopped \
  --env-file .env \
  -e CHATBOT_HOST=0.0.0.0 \
  -e CHATBOT_PORT=8000 \
  infinitive-backend

docker run -d \
  --name chatbot-web \
  --network infinitive-chatbot-net \
  --restart unless-stopped \
  --env-file .env \
  -e CHATBOT_BACKEND_URL=http://chatbot-backend:8000 \
  -p 3000:3000 \
  infinitive-web
```

Only the web container publishes a host port. To stop the manually launched containers and remove their network:

```bash
docker rm -f chatbot-web chatbot-backend
docker network rm infinitive-chatbot-net
```

## 4. Important project files

| File or directory | What it does |
| --- | --- |
| `app/page.tsx` | Chat interface, status polling, browser history/theme, and requests to `/api/chat`. |
| `app/api/chat/route.ts` | Next.js `GET` health proxy and `POST` chat proxy; request-size limit and upstream timeouts. |
| `app/layout.tsx` | Root HTML layout and page metadata. |
| `app/globals.css` | Global styles. |
| `backend/server.py` | Python HTTP server, validation, knowledge retrieval, OpenRouter request, and fallback response. |
| `backend/knowledge_base.txt` | Searchable reference text bundled into the backend image. |
| `Dockerfile` | Multi-stage build for the Next.js web container. Next.js build output is configured as `.next-local`. |
| `backend/Dockerfile` | Build instructions for the Python backend container. |
| `compose.yaml` | Service definitions, environment, networking, host port mapping, restart behavior, and backend health check. |
| `.env.example` | Safe template for Compose environment variables. Copy it to `.env` for deployment. |
| `package.json` and `package-lock.json` | Frontend dependencies and npm scripts. |
| `requirements.txt` | Python dependencies; currently empty of third-party packages. |

## 5. Networking and environment

### Network layout

```text
User's browser
    | HTTP/HTTPS
    v
VM / reverse proxy (TLS termination)
    | forwards to host port 3000
    v
Web container :3000  ---- private Compose network ---->  Backend container :8000
                                                           |
                                                           +--> OpenRouter HTTPS API (outbound)
```

- Compose publishes the web container as `${WEB_PORT:-3000}:3000`. By default, users connect to the VM on port `3000`.
- The backend listens on port `8000` inside the container network. Compose uses `expose`, not `ports`, so port `8000` is not published on the VM.
- The web container reaches the backend at `http://backend:8000`, where `backend` is the Compose service name and internal DNS name. For manual Docker runs, the example uses `http://chatbot-backend:8000`, the container name on the user-defined network.
- The backend needs outbound HTTPS access to OpenRouter when a key is configured. No inbound public connection to the backend is required.
- If accessing the web app directly, allow the selected web host port through the VM firewall. In a production setup, expose the reverse proxy's public ports and keep the backend port private.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Host port mapped to the web container's port 3000. Change this if the host port is occupied. |
| `PORT` | `3000` | Port used by the Next.js process inside the web container; normally keep it at 3000. |
| `CHATBOT_BACKEND_URL` | `http://backend:8000` | Backend URL used by the Next.js server. In Docker, use the service/container name, not `localhost`. |
| `OPENROUTER_API_KEY` | Empty | Backend credential. If empty, the backend uses local knowledge-base answers. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base; backend appends `/chat/completions`. |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-lightning:free` | Model identifier sent to OpenRouter. It must be available to the configured account/provider. |

The health endpoint reports `mode: "ai"` when a key is configured and `mode: "local-knowledge-base"` otherwise; it does not verify that the key or model works. A chat response uses `mode: "ai"` after successful inference, `mode: "local-fallback"` if inference fails, or `mode: "local-knowledge-base"` if model inference is not configured.

## 6. Routes and request flow

The browser calls only the Next.js API route. The Python API is reached server-to-server over the private container network.

| Path | Method | Where it runs | Purpose |
| --- | --- | --- | --- |
| `/` | `GET` | Next.js web container | Serves the chatbot UI. |
| `/api/chat` | `GET` | Next.js web container | Proxies a health check to backend `/health`; the UI polls it every 15 seconds. Returns `503` if the backend cannot be reached. |
| `/api/chat` | `POST` | Next.js web container | Accepts `{ "messages": [{ "role": "user" or "assistant", "content": "..." }] }` and proxies the request to backend `/chat`. |
| `/health` | `GET` | Python backend, internal | Returns backend status and configured inference mode. Used by Compose health check and the web proxy. |
| `/chat` | `POST` | Python backend, internal | Validates chat messages, retrieves knowledge, optionally calls OpenRouter, and returns `{ "reply": "...", "mode": "..." }`. |

### Chat request sequence

1. A user submits a message in `app/page.tsx`. The browser sends up to the last 12 displayed messages to `POST /api/chat`.
2. `app/api/chat/route.ts` rejects a declared request body over 32 KB, parses the JSON, and forwards it to `${CHATBOT_BACKEND_URL}/chat`. The proxy timeout is 180 seconds.
3. `backend/server.py` accepts at most 32 KB, keeps at most 10 messages, and caps each message at 1,500 characters. It takes the latest user message as the query.
4. The backend searches the knowledge text and selects up to three passages. When both a key and relevant passages exist, it sends the latest query and passages to OpenRouter's chat completions endpoint. Earlier turns are not included in the model prompt.
5. The backend returns a model answer, a local passage-based fallback, or an insufficient-information response. The Next.js route returns the JSON response to the browser, where the UI displays it.

The browser-facing proxy uses a 5-second timeout for health checks. The backend's OpenRouter request timeout is 90 seconds. The Next.js App Router API is implemented using a route handler in `app/api/chat/route.ts`.

## 7. Local development and checks

Run the backend and frontend in separate terminals from the project root. For local frontend-to-backend traffic, use `CHATBOT_BACKEND_URL=http://127.0.0.1:8000` in `.env.local`. The Python backend reads `.env.local` or `.env` from the project root. Keep real keys out of Git.

```bash
# Terminal 1
python backend/server.py

# Terminal 2
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend listens on `127.0.0.1:8000` by default for local runs.

Build and lint the frontend:

```bash
npm run build
npm run lint
```
