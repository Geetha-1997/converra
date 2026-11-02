#!/bin/bash
# Converra EC2 bootstrap - Amazon Linux 2023

set -euo pipefail

REPO_URL="https://github.com/Geetha-1997/converra.git"
REGION="ap-south-1"
PARAM_NAME="groq-chat"
APP_DIR="/opt/groq-chat"

# Install application dependencies
dnf install -y nodejs20 nginx git

# Verify AWS CLI is available
command -v aws >/dev/null 2>&1 || {
    echo "ERROR: AWS CLI is not installed."
    exit 1
}

# Retrieve Groq API key from SSM Parameter Store
GROQ_API_KEY="$(aws ssm get-parameter \
    --region "$REGION" \
    --name "$PARAM_NAME" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text)"

if [ -z "$GROQ_API_KEY" ] || [ "$GROQ_API_KEY" = "None" ]; then
    echo "ERROR: Groq API key retrieval failed."
    exit 1
fi

# Clone application
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR/backend"

npm install --omit=dev

# Create protected environment file
umask 077
cat > /etc/groqchat.env <<EOF
PORT=3000
GROQ_API_KEY=$GROQ_API_KEY
GROQ_MODEL=openai/gpt-oss-20b
EOF

chmod 600 /etc/groqchat.env
unset GROQ_API_KEY

# Configure backend systemd service
cat > /etc/systemd/system/groqchat.service <<'EOF'
[Unit]
Description=Converra backend
Wants=network-online.target
After=network-online.target

[Service]
EnvironmentFile=/etc/groqchat.env
WorkingDirectory=/opt/groq-chat/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Configure Nginx
cat > /etc/nginx/conf.d/groqchat.conf <<'EOF'
server {
    listen 80 default_server;
    root /opt/groq-chat/frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_read_timeout 90s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        try_files $uri /index.html;
    }
}
EOF

chmod -R o+rX "$APP_DIR"

nginx -t
systemctl daemon-reload
systemctl enable --now groqchat nginx

echo "Converra bootstrap completed successfully."
