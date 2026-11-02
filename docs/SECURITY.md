# Converra Security

## Secrets

The Groq API key is a server-side secret.

- Do not place the key in frontend JavaScript.
- Do not commit `.env`.
- Do not print the key in shell output or logs.
- Use AWS Systems Manager Parameter Store SecureString for the AWS deployment.
- Restrict access to the parameter using IAM.
- Rotate the key if it is exposed.

The working parameter name is `groq-chat`.

## IAM

The EC2 instance role should use least privilege.

The current deployment uses Systems Manager permissions and a parameter-specific permission for reading the Groq parameter. Review attached policies and inline policies regularly.

Avoid attaching broad administrator permissions to application instances.

## Network Security

- ALB: public entry point on HTTP/HTTPS.
- Application EC2: private subnets.
- Backend port 3000: should not be directly exposed publicly.
- Application inbound traffic: allow from the ALB security group.
- Administrative access: prefer Systems Manager Session Manager.
- SSH: restrict to trusted sources when required.

## HTTPS

Use an ACM certificate whose domain matches the hostname users access.

Do not treat `curl -k` as a production certificate-validation test. It disables certificate verification.

## Repository Hygiene

The `.gitignore` should exclude:

```gitignore
.env
node_modules/
```

Before pushing:

```powershell
git status --short
git diff --check
git diff -- .env
```

Never commit credentials, private keys, AWS access keys, or environment files.

## Browser Storage

Chat history is stored in browser localStorage. Users sharing the same browser profile may have access to that local browser data. Do not store sensitive information in conversations unless the application is designed to protect it.

## Security Improvements to Consider

- Authentication and authorization.
- API rate limiting.
- Request validation and size limits.
- Security headers.
- Centralized audit logging.
- Secret rotation.
- Dependency vulnerability scanning.
