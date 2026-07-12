FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY server/package*.json ./
RUN npm install --legacy-peer-deps
COPY server/ .
COPY --from=frontend-builder /app/dist ./dist
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "index.js"]
