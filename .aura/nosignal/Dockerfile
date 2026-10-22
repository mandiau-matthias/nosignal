FROM node:24.16.0@sha256:40ad9f3064e67d6860b4bc3fe1880b2953934fd6320ada990e45fe0efa6badd7
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg openssl python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir -p /snap/bin && ln -s /usr/bin/chromium /snap/bin/chromium
