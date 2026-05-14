# scripts/setup-docker-images.ps1
Write-Host "Setting up Docker images for code execution..." -ForegroundColor Green

# Pull base images
Write-Host "Pulling base images..." -ForegroundColor Yellow
docker pull node:18-alpine
docker pull python:3.11-alpine
docker pull gcc:latest
docker pull openjdk:17-slim
docker pull alpine:latest

# Create custom Python image
Write-Host "Creating custom Python sandbox..." -ForegroundColor Yellow
@"
FROM python:3.11-alpine

# Remove dangerous packages
RUN apk del --no-cache curl wget git openssh

# Create non-root user
RUN addgroup -g 1000 -S codeuser && `
    adduser -u 1000 -S codeuser -G codeuser

# Set permissions
USER codeuser
WORKDIR /app

# Disable dangerous functions
ENV PYTHONDONTWRITEBYTECODE=1 `
    PYTHONUNBUFFERED=1 `
    PYTHONHASHSEED=random
"@ | Out-File -FilePath Dockerfile.python -Encoding UTF8

docker build -f Dockerfile.python -t sandbox-python:latest .

# Create custom Node image
Write-Host "Creating custom Node sandbox..." -ForegroundColor Yellow
@"
FROM node:18-alpine

# Remove dangerous packages
RUN apk del --no-cache curl wget git

# Create non-root user
RUN addgroup -g 1000 -S codeuser && `
    adduser -u 1000 -S codeuser -G codeuser

USER codeuser
WORKDIR /app

# Disable dangerous modules
ENV NODE_OPTIONS="--disable-proto=delete --max-old-space-size=128"
"@ | Out-File -FilePath Dockerfile.node -Encoding UTF8

docker build -f Dockerfile.node -t sandbox-node:latest .

Write-Host "Docker images ready!" -ForegroundColor Green