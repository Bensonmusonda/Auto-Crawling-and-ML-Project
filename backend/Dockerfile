FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir \
    --default-timeout=1000 \
    --retries 5 \
    -r requirements.txt
    
# Download spaCy model
RUN python -m spacy download en_core_web_sm

COPY . .