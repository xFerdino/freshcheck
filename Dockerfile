FROM maximhq/bifrost:latest AS bifrost-bin

FROM python:3.11-slim
WORKDIR /app

# Install curl/ca-certificates if needed
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Copy Bifrost binary and configuration
COPY --from=bifrost-bin /bifrost /usr/local/bin/bifrost
COPY bifrost/ /app/bifrost/

# Python dependencies
COPY backend/requirements.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

# Backend application code
COPY backend/ /app/backend/

# Startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8001
CMD ["/app/start.sh"]
