#!/bin/bash

echo "Starting test execution..." > test-output.log

# Check Node version
echo "Node version:" >> test-output.log
node -v >> test-output.log 2>&1

# Check npm version
echo "NPM version:" >> test-output.log
npm -v >> test-output.log 2>&1

# Run linting
echo -e "\n=== Running ESLint ===" >> test-output.log
npm run lint >> test-output.log 2>&1
LINT_EXIT=$?
echo "Lint exit code: $LINT_EXIT" >> test-output.log

# Run tests
echo -e "\n=== Running Tests ===" >> test-output.log
NODE_OPTIONS=--experimental-vm-modules npm test >> test-output.log 2>&1
TEST_EXIT=$?
echo "Test exit code: $TEST_EXIT" >> test-output.log

# Summary
echo -e "\n=== Summary ===" >> test-output.log
if [ $LINT_EXIT -eq 0 ] && [ $TEST_EXIT -eq 0 ]; then
    echo "✅ All checks passed!" >> test-output.log
else
    echo "❌ Some checks failed" >> test-output.log
    echo "Lint: $LINT_EXIT, Test: $TEST_EXIT" >> test-output.log
fi

echo "Test execution completed. Check test-output.log for results." 