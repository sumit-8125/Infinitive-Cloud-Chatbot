# Infinitive Cloud Assistant

The Next.js frontend and Python backend run as separate Docker Compose services. The backend uses the extracted knowledge text in `backend/knowledge_base.txt`; this current extractive setup does not need a model API key.

## Deploy with Docker Compose

Install Docker Engine and the Compose plugin **inside the Ubuntu VM**, then transfer this project folder to the VM. Do not install the app's containers on the Proxmox host itself. Do not copy `.env.local`, `node_modules`, `.next-local`, or `.git`.

On Ubuntu, install Docker from its official repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run hello-world
```

From the project folder, create the local Compose environment file and start both services:

```bash
cp .env.example .env
docker compose up --build -d
```

The `.env.example` file contains only non-secret defaults. Keep any real `.env` private; it is ignored by Git and excluded from Docker build contexts. The current PDF-only backend needs no provider key.

Check service status and logs:

```bash
docker compose ps
docker compose logs -f
```

The web app is available on port `3000`. Open `http://<VM-IP>:3000` or place a reverse proxy with HTTPS in front of it. The Python backend is reachable only inside the Compose network; the frontend calls it using `http://backend:8000`.

To stop the services:

```bash
docker compose down
```

To rebuild after changing the frontend or backend:

```bash
docker compose up --build -d
```

## Dependencies

- `package.json` and `package-lock.json` specify the frontend dependencies; the frontend image installs them with `npm ci`.
- `requirements.txt` is the Python dependency list. The backend currently uses only Python's standard library, so no third-party Python packages are required. The backend image still runs `pip install -r requirements.txt` so future Python packages can be listed there.

## Run locally without Docker

Use two terminals:

```bash
python backend/server.py
```

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The local frontend proxy uses `http://127.0.0.1:8000` by default.
