#!/bin/bash

echo "========================================"
echo "HealthConnect Load Testing Suite"
echo "Testing at: LOW (100), MEDIUM (500), HIGH (1000) concurrent users"
echo "========================================"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo "k6 not found. Using Docker..."
    K6_CMD="docker run --rm -i --network=host -v \$(pwd)/load-tests:/tests grafana/k6:latest run"
else
    K6_CMD="k6 run"
fi

# Create results directory
mkdir -p load-tests/results

echo "Starting tests. This will take approximately 45-60 minutes total."
echo "Monitor Grafana: http://localhost:3001 (admin/admin)"
echo "Monitor Prometheus: http://localhost:9091"
echo ""

# Test 1: LOW LOAD (100 users)
echo "========================================  "
echo "TEST 1/3: LOW LOAD - 100 Concurrent Users"
echo "========================================  "
echo "Expected: System should handle this easily"
echo ""

$K6_CMD /tests/test-100-users.js --out json=/tests/results/test-100-results.json 2>&1 | tee load-tests/results/test-100-output.txt

echo ""
echo "Cooldown period: 60 seconds..."
sleep 60

# Test 2: MEDIUM LOAD (500 users)
echo ""
echo "========================================  "
echo "TEST 2/3: MEDIUM LOAD - 500 Concurrent Users"
echo "========================================  "
echo "Expected: System may show degradation"
echo ""

$K6_CMD /tests/test-500-users.js --out json=/tests/results/test-500-results.json 2>&1 | tee load-tests/results/test-500-output.txt

echo ""
echo "Cooldown period: 120 seconds..."
sleep 120

# Test 3: HIGH LOAD (1000 users)
echo ""
echo "========================================  "
echo "TEST 3/3: HIGH LOAD - 1000 Concurrent Users"
echo "========================================  "
echo "WARNING: This may push system to limits"
echo ""

$K6_CMD /tests/test-1000-users.js --out json=/tests/results/test-1000-results.json 2>&1 | tee load-tests/results/test-1000-output.txt

echo ""
echo "========================================"
echo "ALL TESTS COMPLETED"
echo "========================================"
echo ""
echo "Results saved in: load-tests/results/"
echo ""
echo "Next steps:"
echo "1. Review Grafana dashboards for visual metrics"
echo "2. Query Prometheus for detailed data"
echo "3. Generate report with: node load-tests/generate-report.js"
echo ""
