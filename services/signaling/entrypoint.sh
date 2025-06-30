#!/bin/sh

# Generate config file
/app/bin/generate-config.sh

# Start server
node /app/bin/server.js start --config /app/bin/config/config.json

