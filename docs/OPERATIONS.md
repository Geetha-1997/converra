# Converra Operations Runbook

## AWS Region

`ap-south-1`

## Important Resources

| Resource | Identifier |
|---|---|
| Application Load Balancer | converra-alb |
| ALB DNS | converra-alb-1263767965.ap-south-1.elb.amazonaws.com |
| Target group | converra-tg |
| Auto Scaling Group | converra-asg |
| Launch template | lt-0a54cc2dac91ddfb5 |
| Backend service | groqchat |
| Application directory | /opt/groq-chat |
| Environment file | /etc/groqchat.env |
| SSM parameter | groq-chat |

Verify identifiers in AWS before executing operational changes.

## Health Checks

From an EC2 instance:

```bash
curl -i http://127.0.0.1:3000/health
```

Expected response:

```json
{"status":"ok"}
```

Check models:

```bash
curl -i http://127.0.0.1:3000/api/models
```

Check the systemd service:

```bash
sudo systemctl status groqchat
sudo systemctl status nginx
```

## Application Logs

```bash
sudo journalctl -u groqchat -n 100 --no-pager
sudo journalctl -u groqchat -f
```

Nginx logs:

```bash
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -n 100 /var/log/nginx/access.log
```

Cloud-init logs:

```bash
sudo tail -n 100 /var/log/cloud-init-output.log
```

Never print `/etc/groqchat.env` because it contains the API key.

## AWS CLI Checks from PowerShell

Set region:

```powershell
$region = "ap-south-1"
```

Check Auto Scaling instances:

```powershell
aws autoscaling describe-auto-scaling-groups `
  --auto-scaling-group-names converra-asg `
  --region $region `
  --output table
```

Check target health:

```powershell
aws elbv2 describe-target-health `
  --target-group-arn "arn:aws:elasticloadbalancing:ap-south-1:703057690812:targetgroup/converra-tg/f1d4184c22c267ac" `
  --region $region `
  --output table
```

Check SSM managed instances:

```powershell
aws ssm describe-instance-information `
  --region $region `
  --output table
```

Check ALB listeners:

```powershell
aws elbv2 describe-listeners `
  --load-balancer-arn "arn:aws:elasticloadbalancing:ap-south-1:703057690812:loadbalancer/app/converra-alb/f7cca1d78df64709" `
  --region $region `
  --output table
```

## SSM Parameter Verification

Verify the parameter exists without printing its value:

```powershell
aws ssm get-parameter `
  --name "groq-chat" `
  --with-decryption `
  --query "Parameter.Name" `
  --output text `
  --region ap-south-1
```

Do not query or print `Parameter.Value` in shared terminal output.

## Safe Recovery Sequence

1. Check ALB target health.
2. Identify the unhealthy instance.
3. Check SSM connectivity.
4. Check `groqchat` and Nginx service status.
5. Check application and Nginx logs.
6. Verify the environment file exists and has restrictive permissions without displaying its contents.
7. Verify the instance can retrieve the SSM parameter.
8. Restart a service only after identifying the failure.
9. Recheck `/health` and target health.

Avoid terminating instances or changing Auto Scaling processes without understanding the impact.
