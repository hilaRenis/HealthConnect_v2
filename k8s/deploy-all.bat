@echo off
REM HealthConnect Kubernetes Deployment Script for Windows
REM This script deploys all HealthConnect services to a Kubernetes cluster

echo =========================================
echo HealthConnect Kubernetes Deployment
echo =========================================

REM Check if kubectl is installed
kubectl version >nul 2>&1
if errorlevel 1 (
    echo Error: kubectl is not installed
    exit /b 1
)

REM Check if connected to a cluster
kubectl cluster-info >nul 2>&1
if errorlevel 1 (
    echo Error: Not connected to a Kubernetes cluster
    exit /b 1
)

echo Connected to Kubernetes cluster
kubectl cluster-info

REM Step 1: Create namespace
echo.
echo [1/7] Creating namespace...
kubectl apply -f namespaces/healthconnect-namespace.yaml

REM Step 2: Create ConfigMaps and Secrets
echo.
echo [2/7] Creating ConfigMaps and Secrets...
kubectl apply -f config/configmaps.yaml
kubectl apply -f config/secrets.yaml

REM Step 3: Deploy databases
echo.
echo [3/7] Deploying databases...
kubectl apply -f databases/postgres-auth.yaml
kubectl apply -f databases/postgres-patient.yaml
kubectl apply -f databases/postgres-doctor.yaml
kubectl apply -f databases/postgres-appointment.yaml
kubectl apply -f databases/postgres-admin.yaml

echo Waiting for databases to be ready (30 seconds)...
timeout /t 30 /nobreak

REM Step 4: Deploy messaging (Kafka ^& Zookeeper)
echo.
echo [4/7] Deploying messaging services...
kubectl apply -f messaging/zookeeper.yaml
echo Waiting for Zookeeper (20 seconds)...
timeout /t 20 /nobreak

kubectl apply -f messaging/kafka.yaml
echo Waiting for Kafka (30 seconds)...
timeout /t 30 /nobreak

REM Step 5: Deploy microservices
echo.
echo [5/7] Deploying microservices...
kubectl apply -f services/auth-service/
kubectl apply -f services/patient-service/
kubectl apply -f services/doctor-service/
kubectl apply -f services/appointment-service/
kubectl apply -f services/pharmacy-service/
kubectl apply -f services/admin-service/
kubectl apply -f services/api-gateway/

echo Waiting for services to start (30 seconds)...
timeout /t 30 /nobreak

REM Step 6: Deploy monitoring
echo.
echo [6/7] Deploying monitoring stack...
kubectl apply -f monitoring/prometheus.yaml
kubectl apply -f monitoring/grafana.yaml

REM Step 7: Display deployment status
echo.
echo [7/7] Deployment Summary
echo =========================================

echo.
echo Pods:
kubectl get pods -n healthconnect

echo.
echo Services:
kubectl get services -n healthconnect

echo.
echo Horizontal Pod Autoscalers:
kubectl get hpa -n healthconnect

echo.
echo Persistent Volume Claims:
kubectl get pvc -n healthconnect

echo.
echo =========================================
echo Deployment completed successfully!
echo =========================================

echo.
echo Next Steps:
echo 1. Get API Gateway external IP:
echo    kubectl get service api-gateway -n healthconnect
echo.
echo 2. Get Grafana external IP:
echo    kubectl get service grafana -n healthconnect
echo.
echo 3. Watch pod status:
echo    kubectl get pods -n healthconnect -w
echo.
echo 4. View logs for a specific service:
echo    kubectl logs -f deployment/^<service-name^> -n healthconnect
echo.
echo 5. Check HPA scaling:
echo    kubectl get hpa -n healthconnect -w
