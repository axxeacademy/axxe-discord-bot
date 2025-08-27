# Use official Node.js image
FROM node:20-bookworm

# Install system packages needed by node-canvas
RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  fontconfig \
  fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy the rest of the app
COPY . .

# Build font cache
RUN fc-cache -f -v

# Start your bot (replace index.js if needed)
CMD ["node", "index.js"]
