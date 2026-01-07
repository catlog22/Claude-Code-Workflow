# Phase 3: Best Practices Review

## Objective

Analyze code for best practices violations including code quality, performance issues, and maintainability concerns.

## Input

- **File Inventory**: From Phase 1 (`.code-review/inventory.json`)
- **Security Findings**: From Phase 2 (`.code-review/security-findings.json`)
- **User Arguments**:
  - `--focus best-practices`: Best practices only mode
  - `--check quality,performance,maintainability`: Specific areas to check

## Process

### Step 1: Code Quality Analysis

Check naming conventions, function complexity, code duplication, and dead code detection.

### Step 2: Performance Analysis

Detect N+1 queries, inefficient algorithms, and memory leaks.

### Step 3: Maintainability Analysis

Check documentation coverage, test coverage, and dependency management.

## Output

- best-practices-findings.json
- Markdown report with recommendations

## Next Phase

**Phase 4: Report Generation**
