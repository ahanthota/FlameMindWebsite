# Build from the repo root so the science data can be copied in:
#   docker build -f api/Dockerfile -t flamemind-api .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ .

# Science data is baked into the image. Nothing is fetched at runtime.
COPY data/chunks.json data/embeddings.npy data/embeddings_meta.json \
     data/investigations.json data/habitats.json data/gaps.json data/insights.json \
     data/answer_cache.json data/derived_cache.json ./data/

# Cloud Run injects PORT. The default keeps a local `docker run` usable.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
