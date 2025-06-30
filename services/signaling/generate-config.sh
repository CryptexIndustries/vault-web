#!/bin/sh

BASE_DIR="/app/bin"
CONFIG_DIR="$BASE_DIR/config"
CONFIG_FILE="$CONFIG_DIR/config.json"
CONFIG_TEMPLATE_FILE="$BASE_DIR/config.template.json"
FORCE=${OVERRIDE_FORCE_GENERATE_CONFIG:-false}
DEV_MODE=${OVERRIDE_DEV_MODE:-false}

echo "[GEN-CFG]: Running config generation..."

# Check if the config.json file exists
if [ -f "$CONFIG_FILE" ] && [ "$FORCE" = false ]; then
    echo "[GEN-CFG]: Will not overwrite config.json file. Please set the OVERRIDE_FORCE_GENERATE_CONFIG environment variable to true to overwrite it."
    exit 2
elif [ "$FORCE" = true ]; then
    echo "[GEN-CFG]: Found config.json file. Forcing overwrite..."
fi

echo "[GEN-CFG]: Reading environment variables and generating configuration file..."

PORT=${OVERRIDE_SERVER_PORT:-6001}
APP_USER_AUTHENTICATION=${OVERRIDE_APP_USER_AUTHENTICATION:-true}
APP_ID=${OVERRIDE_APP_ID:-$(uuidgen)}
APP_KEY=${OVERRIDE_APP_KEY:-$(uuidgen)}
SECRET=${OVERRIDE_APP_SECRET:-$(echo "$(uuidgen)$(uuidgen)" | base64 -w 0)}

# Make sure the SECRET doesn't have any special characters (+, /, =)
SECRET=$(echo "$SECRET" | sed 's/[+|/|=]//g')

mkdir -p "$CONFIG_DIR"

# Create a copy of the config.template.json and replace the values
cp "$CONFIG_TEMPLATE_FILE" "$CONFIG_FILE"
sed -i "s/{{PORT_TO_GENERATE}}/$PORT/g" "$CONFIG_FILE"
sed -i "s/{{DEV_MODE_TO_GENERATE}}/$DEV_MODE/g" "$CONFIG_FILE"
sed -i "s/{{APP_USER_AUTHENTICATION_TO_GENERATE}}/$APP_USER_AUTHENTICATION/g" "$CONFIG_FILE"

sed -i "s/{{APP_ID_TO_GENERATE}}/$APP_ID/g" "$CONFIG_FILE"
sed -i "s/{{APP_KEY_TO_GENERATE}}/$APP_KEY/g" "$CONFIG_FILE"
sed -i "s/{{APP_SECRET_TO_GENERATE}}/$SECRET/g" "$CONFIG_FILE"

echo -e "\t[DEV MODE] $DEV_MODE"
echo -e "\t[APP ID] $APP_ID"
echo -e "\t[APP KEY] $APP_KEY"
echo -e "\t[SECRET] $SECRET"

echo -e "[GEN-CFG]: Configuration file generated successfully!"

