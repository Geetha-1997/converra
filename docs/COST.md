# Converra AWS Cost Management

## Cost Principles

Converra uses paid AWS infrastructure. Resources can incur charges while idle.

Review the AWS Billing console and Cost Explorer regularly.

## Cost-sensitive Resources

| Resource | Cost consideration |
|---|---|
| NAT Gateway | Hourly charge and data processing |
| Application Load Balancer | Hourly and capacity-based charges |
| EC2 instances | Instance runtime and storage |
| EBS volumes | Provisioned storage |
| Elastic IP addresses | Charges may apply depending on usage and attachment |
| Data transfer | Internet and cross-AZ transfer charges |
| CloudWatch | Logs, metrics, alarms, dashboards |

## Current Architecture Considerations

- A single NAT Gateway is cheaper than one NAT Gateway per AZ, but introduces an AZ dependency for private subnet egress.
- Two application EC2 instances provide availability across two AZs but cost more than one.
- ALB incurs charges while provisioned.
- No RDS database is required for the current application.
- EKS is not part of the current deployed architecture.

## Cost Controls

- Set an AWS Budget and billing alerts.
- Review EC2 instance sizes and utilization.
- Review NAT Gateway data processing.
- Configure log retention.
- Remove unused snapshots and unattached volumes after verification.
- Avoid creating duplicate NAT Gateways.
- Stop or delete non-production resources when no longer needed.
- Check public IPv4 and Elastic IP usage.

## Before Deleting Resources

Do not delete the VPC, NAT Gateway, ALB, or EC2 resources without reviewing dependencies.

A safe cleanup plan should identify:

1. Auto Scaling Groups and launch templates.
2. Load balancers and target groups.
3. NAT Gateway and Elastic IP associations.
4. EC2 instances and EBS volumes.
5. Route tables and subnet associations.
6. Internet Gateway.
7. Security groups and network interfaces.

Use the AWS Billing console to confirm charges rather than relying on estimated prices in documentation.
