# Converra — local run + AWS 3-tier deployment

## Part 1: Run locally (10 minutes)

Requirements: Docker Desktop, a Groq API key (https://console.groq.com/keys).

```bash
cd converra
cp .env.example .env        # then edit .env and paste your GROQ_API_KEY
docker compose up --build
```

Open http://localhost:8080 and chat. Messages are saved in Postgres
(`docker compose down -v` wipes the data).

---

## Part 2: AWS architecture (Region: ap-south-1 Mumbai)

```
                     Route 53  (chat.yourdomain.com  -> ALB alias)
                         |
        Internet ---> Application Load Balancer   (public subnets, AZ-a + AZ-b)
                         |
        Auto Scaling Group, EC2 running nginx + Node  (private APP subnets, AZ-a + AZ-b)
                         |
        RDS PostgreSQL, Multi-AZ                       (private DB subnets, AZ-a + AZ-b)

   Bastion host (public subnet, Elastic IP)  -> SSH into private EC2s
   NAT Gateway (public subnet, Elastic IP)   -> lets private EC2s reach Groq / yum / GitHub
```

| Subnet | CIDR | AZ | Used for |
|---|---|---|---|
| public-a | 10.0.1.0/24 | ap-south-1a | ALB, NAT GW, bastion |
| public-b | 10.0.2.0/24 | ap-south-1b | ALB |
| app-a | 10.0.11.0/24 | ap-south-1a | App EC2 (ASG) |
| app-b | 10.0.12.0/24 | ap-south-1b | App EC2 (ASG) |
| db-a | 10.0.21.0/24 | ap-south-1a | RDS |
| db-b | 10.0.22.0/24 | ap-south-1b | RDS standby |

Note: an Application Load Balancer cannot use an Elastic IP (it has its own DNS name,
which is why Route 53 uses an Alias record). Elastic IPs are used for the **bastion**
and the **NAT Gateway**.

### Step 0 — Push code to GitHub
Create a (public, or use a deploy token for private) repo named `converra`, push this folder.
Then edit `REPO_URL` in `deploy/user-data.sh`.

### Step 1 — VPC (use the wizard)
VPC console -> **Create VPC** -> **VPC and more**
- Name: `groqchat`, CIDR `10.0.0.0/16`
- AZs: 2, Public subnets: 2, Private subnets: 2
- NAT gateways: **In 1 AZ** (cheaper; choose "1 per AZ" for full HA), VPC endpoints: None

The wizard creates the public + 2 private subnets, route tables, IGW and NAT (with an Elastic IP).
Then add the DB subnets: **Subnets -> Create subnet** -> `db-a` 10.0.21.0/24 (AZ a) and
`db-b` 10.0.22.0/24 (AZ b). Leave them on the default (private, no internet) route table.

### Step 2 — Security groups (EC2 -> Security Groups)
| Name | Inbound rule |
|---|---|
| `sg-alb` | HTTP 80 and HTTPS 443 from 0.0.0.0/0 |
| `sg-bastion` | SSH 22 from **your IP** (My IP) |
| `sg-app` | HTTP 80 from `sg-alb`; SSH 22 from `sg-bastion` |
| `sg-db` | PostgreSQL 5432 from `sg-app` |

### Step 3 — Database (RDS)
1. RDS -> **Subnet groups** -> create `db-subnets` with `db-a` and `db-b`.
2. **Create database** -> PostgreSQL -> Templates: *Dev/Test* (use *Production* for real Multi-AZ standby)
3. Identifier `groqchat-db`, master user `chatuser`, set a password.
4. Instance `db.t4g.micro`, **Multi-AZ standby: yes** (optional while testing), VPC `groqchat`,
   subnet group `db-subnets`, Public access **No**, security group `sg-db`.
5. Additional configuration -> Initial database name: `chatdb`.
6. Wait until Available, copy the **endpoint**.

### Step 4 — Secrets in SSM Parameter Store
Systems Manager -> Parameter Store -> create (region ap-south-1):
- `/groqchat/GROQ_API_KEY` — SecureString — your Groq key
- `/groqchat/DB_PASSWORD` — SecureString — the RDS password
- `/groqchat/DB_HOST` — String — the RDS endpoint

### Step 5 — IAM role for EC2
IAM -> Roles -> Create -> EC2 -> attach `AmazonSSMReadOnlyAccess`
-> name `groqchat-ec2-role`.

### Step 6 — Key pair + Bastion
1. EC2 -> Key pairs -> create `groqchat-key` (.pem) and keep the file safe.
2. Launch instance: `bastion`, Amazon Linux 2023, t3.micro, key `groqchat-key`,
   subnet `public-a`, auto-assign public IP **disabled**, SG `sg-bastion`.
3. EC2 -> **Elastic IPs** -> Allocate -> Associate with `bastion`.

### Step 7 — Launch Template
EC2 -> Launch templates -> Create:
- AMI Amazon Linux 2023, type `t3.small`, key `groqchat-key`, SG `sg-app`
- Advanced -> IAM instance profile `groqchat-ec2-role`
- Advanced -> User data: paste `deploy/user-data.sh` (after editing the repo URL)

### Step 8 — Target group + Load balancer
1. Target groups -> Create: Instances, HTTP 80, VPC groqchat, health check path `/health`.
   (Don't register targets manually.)
2. Load balancers -> Create **Application Load Balancer**: internet-facing, VPC groqchat,
   mappings: `public-a` + `public-b`, SG `sg-alb`, listener HTTP 80 -> the target group.

### Step 9 — Auto Scaling Group
EC2 -> Auto Scaling groups -> Create:
- Launch template from Step 7, VPC groqchat, subnets **app-a + app-b**
- Attach to existing load balancer -> the target group; turn on ELB health checks
- Desired 2, Min 2, Max 4
- Scaling policy: **Target tracking**, Average CPU 60%

After ~3 minutes, open the ALB's DNS name in a browser — your chat app should load.

### Step 10 — Domain with Route 53 (+ HTTPS)
1. Route 53 -> Hosted zones -> create one for `yourdomain.com` and copy its 4 NS records
   into your registrar (skip if you bought the domain in Route 53).
2. **HTTPS:** Certificate Manager (ACM) -> Request public cert for `chat.yourdomain.com`
   -> DNS validation -> "Create records in Route 53".
3. ALB -> add listener HTTPS 443 using the cert, forward to the target group.
   Edit the HTTP:80 listener to redirect to HTTPS.
4. Route 53 -> Create record: name `chat`, type **A**, **Alias** to the Application Load Balancer.

Visit https://chat.yourdomain.com.

### Step 11 — Using the bastion
```bash
# from your laptop
chmod 400 groqchat-key.pem
ssh-add groqchat-key.pem
ssh -A ec2-user@<BASTION_ELASTIC_IP>
# then, from the bastion:
ssh ec2-user@<APP_EC2_PRIVATE_IP>
sudo journalctl -u groqchat -f      # backend logs
```

### Troubleshooting
- Targets unhealthy -> SSH in, `sudo journalctl -u groqchat`, and `cat /var/log/cloud-init-output.log`.
- "Could not connect to database" -> check `sg-db` allows `sg-app`, and the SSM `DB_HOST` value.
- Groq errors (401/404) -> check the key and that `GROQ_MODEL` is still available in the Groq console.

### Cost warning
NAT Gateway, RDS, ALB and 2 EC2s cost money even when idle (roughly a few hundred ₹ per day).
When you're done: delete the ASG, ALB, RDS, NAT Gateway, release the Elastic IPs, then the VPC.
