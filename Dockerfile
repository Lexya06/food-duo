FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Expose server port (default 3000)
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["npm", "start"]
