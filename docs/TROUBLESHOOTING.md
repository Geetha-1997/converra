# Converra Troubleshooting

## Application health endpoint fails

Check the backend:

```bash
sudo systemctl status groqchat
curl -i http://127.0.0.1:3000/health
sudo journalctl -u groqchat -n 100 --no-pager
```

Check Nginx:

```bash
sudo systemctl status nginx
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
```

## ALB target is unhealthy

Check:

- EC2 instance is running.
- Nginx is listening on port 80.
- Target group health check path is `/health`.
- The application security group allows inbound port 80 from the ALB security group.
- Backend service is active.

## GROQ_API_KEY is not set

The backend requires `GROQ_API_KEY`.

Check that the environment file exists without displaying its contents:

```bash
sudo test -f /etc/groqchat.env && echo "Environment file exists"
sudo stat -c "%a %U %G" /etc/groqchat.env
sudo systemctl status groqchat
```

Verify the SSM parameter name without displaying its value:

```bash
aws ssm get-parameter \
  --name groq-chat \
  --with-decryption \
  --query Parameter.Name \
  --output text \
  --region ap-south-1
```

The checked-in bootstrap script currently references an older parameter path. Review `deploy/user-data.sh` before using it to launch replacement instances.

## Groq API errors

Check:

- API key validity.
- Provider account limits and rate limits.
- Model availability.
- Outbound connectivity from the private EC2 subnet through NAT.
- Backend logs for the HTTP status.

Do not log or share the API key.

## HTTPS certificate errors

Check:

- HTTPS listener exists.
- ACM certificate status is `ISSUED`.
- Certificate covers the hostname being accessed.
- DNS resolves to the intended ALB.
- Certificate chain is trusted.

Do not use `curl -k` as proof that TLS validation is working. It bypasses certificate checks.

## Docker local deployment problems

```powershell
docker compose ps
docker compose logs --tail 100
docker compose config
```

Check that `.env` exists and contains the required variables without sharing its contents.

The local frontend is exposed on port `8082`.

## Chat history missing

Conversation history is stored in browser localStorage. It is not stored in a server-side database. Clearing browser storage or changing browser profiles can make that history unavailable.
