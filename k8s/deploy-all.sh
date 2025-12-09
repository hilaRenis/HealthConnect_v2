#!/bin/bash

# HealthConnect Kubernetes Deployment Script
# This script deploys all HealthConnect services to a Kubernetes cluster

set -e

echo "========================================="
echo "HealthConnect Kubernetes Deployment"
echo "========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: kubectl is not installed${NC}"
    exit 1
fi

# Check if connected to a cluster
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}Error: Not connected to a Kubernetes cluster${NC}"
    exit 1
fi

echo -e "${GREEN}Connected to Kubernetes cluster${NC}"
kubectl cluster-info

# Step 1: Create namespace
echo -e "\n${YELLOW}[1/7] Creating namespace...${NC}"
kubectl apply -f namespaces/healthconnect-namespace.yaml

# Step 2: Create ConfigMaps and Secrets
echo -e "\n${YELLOW}[2/7] Creating ConfigMaps and Secrets...${NC}"
kubectl apply -f config/configmaps.yaml
kubectl apply -f config/secrets.yaml

# Step 3: Deploy databases
echo -e "\n${YELLOW}[3/7] Deploying databases...${NC}"
kubectl apply -f databases/postgres-auth.yaml
kubectl apply -f databases/postgres-patient.yaml
kubectl apply -f databases/postgres-doctor.yaml
kubectl apply -f databases/postgres-appointment.yaml
kubectl apply -f databases/postgres-admin.yaml

echo "Waiting for databases to be ready (30 seconds)..."
sleep 30

# Step 4: Deploy messaging (Kafka & Zookeeper)
echo -e "\n${YELLOW}[4/7] Deploying messaging services...${NC}"
kubectl apply -f messaging/zookeeper.yaml
echo "Waiting for Zookeeper (20 seconds)..."
sleep 20

kubectl apply -f messaging/kafka.yaml
echo "Waiting for Kafka (30 seconds)..."
sleep 30

# Step 5: Deploy microservices
echo -e "\n${YELLOW}[5/7] Deploying microservices...${NC}"
kubectl apply -f services/auth-service/
kubectl apply -f services/patient-service/
kubectl apply -f services/doctor-service/
kubectl apply -f services/appointment-service/
kubectl apply -f services/pharmacy-service/
kubectl apply -f services/admin-service/
kubectl apply -f services/api-gateway/

echo "Waiting for services to start (30 seconds)..."
sleep 30

# Step 6: Deploy monitoring
echo -e "\n${YELLOW}[6/7] Deploying monitoring stack...${NC}"
kubectl apply -f monitoring/prometheus.yaml
kubectl apply -f monitoring/grafana.yaml

# Step 7: Display deployment status
echo -e "\n${YELLOW}[7/7] Deployment Summary${NC}"
echo -e "${GREEN}=========================================${NC}"

echo -e "\n${GREEN}Pods:${NC}"
kubectl get pods -n healthconnect

echo -e "\n${GREEN}Services:${NC}"
kubectl get services -n healthconnect

echo -e "\n${GREEN}Horizontal Pod Autoscalers:${NC}"
kubectl get hpa -n healthconnect

echo -e "\n${GREEN}Persistent Volume Claims:${NC}"
kubectl get pvc -n healthconnect

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo "1. Get API Gateway external IP:"
echo "   kubectl get service api-gateway -n healthconnect"
echo ""
echo "2. Get Grafana external IP:"
echo "   kubectl get service grafana -n healthconnect"
echo ""
echo "3. Watch pod status:"
echo "   kubectl get pods -n healthconnect -w"
echo ""
echo "4. View logs for a specific service:"
echo "   kubectl logs -f deployment/<service-name> -n healthconnect"
echo ""
echo "5. Check HPA scaling:"
echo "   kubectl get hpa -n healthconnect -w"
