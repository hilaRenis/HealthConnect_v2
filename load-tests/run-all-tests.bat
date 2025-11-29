@echo off
SETLOCAL EnableDelayedExpansion

echo ========================================
echo HealthConnect Load Testing Suite
echo Testing at: LOW (100), MEDIUM (500), HIGH (1000) concurrent users
echo ========================================
echo.

REM Create results directory
if not exist "load-tests\results" mkdir "load-tests\results"

echo Starting tests. This will take approximately 45-60 minutes total.
echo Monitor Grafana: http://localhost:3001 (admin/admin)
echo Monitor Prometheus: http://localhost:9091
echo.

REM Test 1: LOW LOAD (100 users)
echo ========================================
echo TEST 1/3: LOW LOAD - 100 Concurrent Users
echo ========================================
echo Expected: System should handle this easily
echo.

k6 run load-tests\test-100-users.js --out json=load-tests\results\test-100-results.json > load-tests\results\test-100-output.txt 2>&1

if %errorlevel% neq 0 (
    echo Test failed or k6 not installed
    echo Trying with Docker...
    docker run --rm -i --network=host -v "%cd%\load-tests:/tests" grafana/k6:latest run /tests/test-100-users.js
)

echo.
echo Cooldown period: 60 seconds...
timeout /t 60 /nobreak >nul
echo.

REM Test 2: MEDIUM LOAD (500 users)
echo ========================================
echo TEST 2/3: MEDIUM LOAD - 500 Concurrent Users
echo ========================================
echo Expected: System may show degradation
echo.

k6 run load-tests\test-500-users.js --out json=load-tests\results\test-500-results.json > load-tests\results\test-500-output.txt 2>&1

if %errorlevel% neq 0 (
    docker run --rm -i --network=host -v "%cd%\load-tests:/tests" grafana/k6:latest run /tests/test-500-users.js
)

echo.
echo Cooldown period: 120 seconds...
timeout /t 120 /nobreak >nul
echo.

REM Test 3: HIGH LOAD (1000 users)
echo ========================================
echo TEST 3/3: HIGH LOAD - 1000 Concurrent Users
echo ========================================
echo WARNING: This may push system to limits
echo.

k6 run load-tests\test-1000-users.js --out json=load-tests\results\test-1000-results.json > load-tests\results\test-1000-output.txt 2>&1

if %errorlevel% neq 0 (
    docker run --rm -i --network=host -v "%cd%\load-tests:/tests" grafana/k6:latest run /tests/test-1000-users.js
)

echo.
echo ========================================
echo ALL TESTS COMPLETED
echo ========================================
echo.
echo Results saved in: load-tests\results\
echo.
echo Next steps:
echo 1. Review Grafana dashboards for visual metrics
echo 2. Query Prometheus for detailed data
echo 3. Check results files in load-tests\results\
echo.

pause
