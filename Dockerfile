FROM node:20-alpine

WORKDIR /app

# Copy root and frontend package manifests
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install root dependencies
RUN npm install --production=false

# Install frontend dependencies
RUN npm --prefix frontend install

# Copy application source code
COPY . .

# Build React production bundle
RUN npm --prefix frontend run build

# Expose default port
EXPOSE 4000

# Start Express server
CMD ["npm", "start"]
