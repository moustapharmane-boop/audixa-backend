FROM node:22-alpine

WORKDIR /app

# Install yt-dlp and ffmpeg
RUN apk add --no-cache yt-dlp ffmpeg

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8080
CMD ["npm", "start"]
