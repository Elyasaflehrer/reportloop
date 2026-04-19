# Create a Security Group that allows all inbound traffic from anywhere
resource "aws_security_group" "allow_all" {
  name        = "allow_all"
  description = "Allow all inbound traffic from anywhere"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 0
    to_port     = 65535  # Allow all ports
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # Allow traffic from anywhere
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"  # Allow all outbound traffic
    cidr_blocks = ["0.0.0.0/0"]  # Allow traffic to anywhere
  }
}

# Create a VPC
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  enable_dns_support = true
  enable_dns_hostnames = true
}

# Create an Internet Gateway
resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
}

# Create a Public Subnet
resource "aws_subnet" "main" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}

# Associate the Public Subnet with a Route Table to route traffic to the Internet Gateway
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
}

# Create a Route in the Route Table to the Internet Gateway
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"  # All traffic
  gateway_id             = aws_internet_gateway.gw.id
}

# Associate the Route Table with the Public Subnet
resource "aws_route_table_association" "public_subnet_assoc" {
  subnet_id      = aws_subnet.main.id
  route_table_id = aws_route_table.public.id
}

# Create an EC2 instance
resource "aws_instance" "web_server" {
  ami           = "ami-0ec10929233384c7f" # Update with the latest Amazon Linux 2 AMI
  instance_type = "t3.micro"

  subnet_id = aws_subnet.main.id
  vpc_security_group_ids = [aws_security_group.allow_all.id]  # Use vpc_security_group_ids

  tags = {
    Name = "WebServer"
  }
}
# # Create an Internet Gateway to access the web
# resource "aws_internet_gateway" "main" {
#   vpc_id = aws_vpc.main.id
# }


# # Create an Elastic Load Balancer (Classic)
# resource "aws_elb" "web_elb" {
#   name               = "web-elb"
#   subnets            = [aws_subnet.main.id]
#   security_groups   = [aws_security_group.allow_all.id]
#   cross_zone_load_balancing = true
#   idle_timeout       = 60
#   connection_draining = true
#   health_check {
#     target              = "HTTP:8000/"
#     interval            = 30
#     timeout             = 5
#     unhealthy_threshold = 2
#     healthy_threshold   = 2
#   }

#   listener {
#     lb_port           = 80
#     lb_protocol       = "http"
#     instance_port     = 8000  # Forward traffic to port 8000 on the EC2 instance
#     instance_protocol = "http"
#   }

#   instances = [aws_instance.web_server.id]
# }

# # Output the Load Balancer DNS Name
# output "load_balancer_dns" {
#   value = aws_elb.web_elb.dns_name
# }