# Converra Deployment Guide

## Deployment Targets

Converra supports two deployment modes:

1. Local Docker Compose deployment.
2. AWS EC2 deployment behind an Application Load Balancer.

## Prerequisites

- Git
- Docker Desktop and Docker Compose for local deployment
- Node.js 18 or later for direct backend development
- Groq API key
- AWS CLI for AWS administration
- Appropriate AWS IAM permissions

## Local Docker Deployment

From PowerShell:

```powershell
git clone https://github.com/Geetha-1997/converra.git
Set-Location .\converra

Copy-Item .env.example .env
notepad .env
```

Configure `.env`:

```dotenv
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
```

Build and start:

```powershell
docker compose up --build -d
```

Open:

`http://localhost:8082`

Inspect:

```powershell
docker compose ps
docker compose logs -f
```

Stop:

```powershell
docker compose down
```

## Backend Development Without Docker

```powershell
Set-Location .\backend
npm install
$env:GROQ_API_KEY = "your_groq_api_key"
$env:GROQ_MODEL = "openai/gpt-oss-20b"
npm start
```

Do not paste a real key into shared logs, screenshots, source code, or Git commits. Prefer a local secret-management method.

## AWS Deployment Summary

The documented AWS environment uses:

- Region `ap-south-1`.
- VPC `converra-vpc`.
- Public and private subnets across two AZs.
- Internet-facing ALB.
- Target group health check `/health`.
- EC2 Auto Scaling Group.
- Nginx on port 80.
- Node.js backend on port 3000.
- SSM Parameter Store parameter `groq-chat`.

The ALB sends traffic to the application instances. Nginx serves the frontend and forwards `/api/` and `/health` requests to the local Express backend.

## Current AWS Application Configuration

The working EC2 instances use:

- Application directory: `/opt/groq-chat`
- systemd service: `groqchat`
- Environment file: `/etc/groqchat.env`
- Backend port: `3000`
- Health endpoint: `/health`
- Default model: `openai/gpt-oss-20b`

The environment file must be readable only by the required service account/root. Do not display its contents in terminal output.

## SSM Parameter Store

The working parameter name is:

`groq-chat`

It is stored as `SecureString`. The EC2 instance role requires permission to retrieve and decrypt this parameter.

Do not use the old `/groqchat/GROQ_API_KEY` path in new deployment automation unless the parameter is deliberately recreated and the deployment is updated consistently.

## Important Launch Template Bootstrap Issue

The checked-in `deploy/user-data.sh` currently uses:

`PARAM_PREFIX="/groqchat"`

and retrieves:

`/groqchat/GROQ_API_KEY`

This does not match the working parameter name `groq-chat`. Therefore, do not assume this checked-in user-data script can successfully bootstrap replacement instances in its current state.

Before updating the launch template:

1. Correct the parameter retrieval logic.
2. Validate IAM access to the parameter.
3. Confirm environment-file permissions.
4. Test the bootstrap script on a disposable instance.
5. Verify the service starts and `/health` returns HTTP 200.
6. Create a new launch template version.
7. Review the Auto Scaling Group configuration before applying it.

Do not terminate healthy production instances merely to test bootstrap changes.

## HTTPS and DNS

The ALB has an HTTP listener that redirects to HTTPS. Use a domain covered by the ACM certificate configured on the HTTPS listener.

The generated ALB DNS hostname is not automatically covered by a certificate issued for a custom domain.

If using Route 53:

1. Use a domain you own.
2. Request an ACM certificate for the intended hostname.
3. Complete DNS validation.
4. Attach the issued certificate to the ALB HTTPS listener.
5. Create an Alias record to the ALB.
6. Test HTTPS with normal certificate verification.

## Post-deployment Verification

- EC2 instances are running.
- Auto Scaling Group instances are `InService`.
- SSM managed instances are online.
- `groqchat` systemd service is active.
- Nginx is active.
- Target group targets are healthy.
- `/health` returns HTTP 200.
- `/api/models` returns the model list.
- A chat request returns a Groq response.
- HTTPS certificate validation succeeds for the intended hostname.
