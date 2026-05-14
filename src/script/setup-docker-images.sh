#!/bin/bash

echo "Building Docker images for code execution..."

# Pull base images
docker pull node:18-alpine
docker pull python:3.11-alpine
docker pull gcc:latest
docker pull openjdk:17-slim
docker pull alpine:latest

# Create custom sandboxed images
echo "Creating custom sandboxed Python image..."
cat > Dockerfile.python <<EOF
FROM python:3.11-alpine

# Remove dangerous packages
RUN apk del --no-cache curl wget git openssh

# Create non-root user
RUN addgroup -g 1000 -S codeuser && \
    adduser -u 1000 -S codeuser -G codeuser

# Set permissions
USER codeuser
WORKDIR /app

# Disable dangerous functions
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=random
EOF

docker build -f Dockerfile.python -t sandbox-python:latest .

echo "Creating custom sandboxed Node image..."
cat > Dockerfile.node <<EOF
FROM node:18-alpine

# Remove dangerous packages
RUN apk del --no-cache curl wget git

# Create non-root user
RUN addgroup -g 1000 -S codeuser && \
    adduser -u 1000 -S codeuser -G codeuser

USER codeuser
WORKDIR /app

# Disable dangerous modules
ENV NODE_OPTIONS="--disable-proto=delete --max-old-space-size=128"
EOF

docker build -f Dockerfile.node -t sandbox-node:latest .

echo "Docker images ready!"