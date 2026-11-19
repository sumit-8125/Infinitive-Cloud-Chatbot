FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHATBOT_HOST=0.0.0.0 \
    CHATBOT_PORT=8000

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/server.py ./backend/server.py
COPY backend/knowledge_base.txt ./backend/knowledge_base.txt

EXPOSE 8000
CMD ["python", "backend/server.py"]
