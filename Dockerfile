FROM node:20-slim
RUN apt-get update && apt-get install -y wget unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/models
ENV TRANSFORMERS_CACHE=/app/models
ENV HF_HUB_ENABLE_HF_TRANSFER=1
EXPOSE 3000
CMD ["node", "api/index.js"]
