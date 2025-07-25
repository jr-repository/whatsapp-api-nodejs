#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Install Chrome dependencies for Puppeteer
# This command is specific to Debian/Ubuntu-based systems, which Render uses.
apt-get update
apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-base xdg-utils wget

# Install Node.js dependencies
npm install

# Anda mungkin tidak memerlukan langkah build untuk API sederhana,
# tetapi jika Anda memilikinya (misalnya, kompilasi TypeScript), itu akan ada di sini.
# npm run build
