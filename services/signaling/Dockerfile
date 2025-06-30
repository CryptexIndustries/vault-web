# Use the soketi image
FROM quay.io/soketi/soketi:1.6-16-alpine

# Set environment variables
ARG SOKETI_USER_AUTHENTICATION_TIMEOUT
ENV SOKETI_USER_AUTHENTICATION_TIMEOUT=${OVERRIDE_DOCKER_USER_AUTHENTICATION_TIMEOUT:-5000}

COPY ./entrypoint.sh /app/bin/entrypoint.sh
COPY ./generate-config.sh /app/bin/generate-config.sh
COPY ./config.template.json /app/bin/config.template.json

# Install uuidgen and run the script to generate the config file
RUN apk add uuidgen
RUN chmod +x /app/bin/entrypoint.sh
RUN chmod +x /app/bin/generate-config.sh

ENTRYPOINT ["/app/bin/entrypoint.sh"]
