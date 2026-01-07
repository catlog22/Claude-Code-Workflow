---
name: code-reviewer
description: Comprehensive code review skill for identifying security vulnerabilities and best practices violations. Triggers on "code review", "review code", "security audit", "代码审查".
allowed-tools: Read, Glob, Grep, mcp__ace-tool__search_context, mcp__ccw-tools__smart_search
---

# Code Reviewer

Comprehensive code review skill for identifying security vulnerabilities and best practices violations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Reviewer Workflow                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: Code Discovery     → 发现待审查的代码文件              │
│           & Scoping              - 根据语言/框架识别文件          │
│           ↓                      - 设置审查范围和优先级           │
│                                                                  │
│  Phase 2: Security           → 安全漏洞扫描                      │
│           Analysis               - OWASP Top 10 检查             │
│           ↓                      - 常见漏洞模式识别               │
│                                  - 敏感数据泄露检查               │
│                                                                  │
│  Phase 3: Best Practices     → 最佳实践审查                      │
│           Review                 - 代码质量检查                  │
│           ↓                      - 性能优化建议                   │
│                                  - 可维护性评估                  │
│                                                                  │
│  Phase 4: Report             → 生成审查报告                      │
│           Generation             - 按严重程度分类问题             │
│                                  - 提供修复建议和示例             │
│                                  - 生成可追踪的修复清单           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Security Analysis

- **OWASP Top 10 Coverage**
  - Injection vulnerabilities (SQL, Command, LDAP)
  - Authentication & authorization bypass
  - Sensitive data exposure
  - XML External Entities (XXE)
  - Broken access control
  - Security misconfiguration
  - Cross-Site Scripting (XSS)
  - Insecure deserialization
  - Components with known vulnerabilities
  - Insufficient logging & monitoring

- **Language-Specific Checks**
  - JavaScript/TypeScript: prototype pollution, eval usage
  - Python: pickle vulnerabilities, command injection
  - Java: deserialization, path traversal
  - Go: race conditions, memory leaks

### Best Practices Review

- **Code Quality**
  - Naming conventions
  - Function complexity (cyclomatic complexity)
  - Code duplication
  - Dead code detection

- **Performance**
  - N+1 queries
  - Inefficient algorithms
  - Memory leaks
  - Resource cleanup

- **Maintainability**
  - Documentation quality
  - Test coverage
  - Error handling patterns
  - Dependency management

## Usage

### Basic Review

```bash
# Review entire codebase
/code-reviewer

# Review specific directory
/code-reviewer --scope src/auth

# Focus on security only
/code-reviewer --focus security

# Focus on best practices only
/code-reviewer --focus best-practices
```

### Advanced Options

```bash
# Review with custom severity threshold
/code-reviewer --severity critical,high

# Review specific file types
/code-reviewer --languages typescript,python

# Generate detailed report with code snippets
/code-reviewer --report-level detailed

# Resume from previous session
/code-reviewer --resume
```

## Configuration

Create `.code-reviewer.json` in project root:

```json
{
  "scope": {
    "include": ["src/**/*", "lib/**/*"],
    "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]
  },
  "security": {
    "enabled": true,
    "checks": ["owasp-top-10", "cwe-top-25"],
    "severity_threshold": "medium"
  },
  "best_practices": {
    "enabled": true,
    "code_quality": true,
    "performance": true,
    "maintainability": true
  },
  "reporting": {
    "format": "markdown",
    "output_path": ".code-review/",
    "include_snippets": true,
    "include_fixes": true
  }
}
```

## Output

### Review Report Structure

```markdown
# Code Review Report

## Executive Summary
- Total Issues: 42
- Critical: 3
- High: 8
- Medium: 15
- Low: 16

## Security Findings

### [CRITICAL] SQL Injection in User Query
**File**: src/auth/user-service.ts:145
**Issue**: Unsanitized user input in SQL query
**Fix**: Use parameterized queries

Code Snippet:
\`\`\`typescript
// ❌ Vulnerable
const query = `SELECT * FROM users WHERE username = '${username}'`;

// ✅ Fixed
const query = 'SELECT * FROM users WHERE username = ?';
db.execute(query, [username]);
\`\`\`

## Best Practices Findings

### [MEDIUM] High Cyclomatic Complexity
**File**: src/utils/validator.ts:78
**Issue**: Function has complexity score of 15 (threshold: 10)
**Fix**: Break into smaller functions

...
```

## Phase Documentation

| Phase | Description | Output |
|-------|-------------|--------|
| [01-code-discovery.md](phases/01-code-discovery.md) | Discover and categorize code files | File inventory with metadata |
| [02-security-analysis.md](phases/02-security-analysis.md) | Analyze security vulnerabilities | Security findings list |
| [03-best-practices-review.md](phases/03-best-practices-review.md) | Review code quality and practices | Best practices findings |
| [04-report-generation.md](phases/04-report-generation.md) | Generate comprehensive report | Markdown report |

## Specifications

- [specs/security-requirements.md](specs/security-requirements.md) - Security check specifications
- [specs/best-practices-requirements.md](specs/best-practices-requirements.md) - Best practices standards
- [specs/quality-standards.md](specs/quality-standards.md) - Overall quality standards
- [specs/severity-classification.md](specs/severity-classification.md) - Issue severity criteria

## Templates

- [templates/security-finding.md](templates/security-finding.md) - Security finding template
- [templates/best-practice-finding.md](templates/best-practice-finding.md) - Best practice finding template
- [templates/report-template.md](templates/report-template.md) - Final report template

## Integration with Development Workflow

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Run code review on staged files
staged_files=$(git diff --cached --name-only --diff-filter=ACMR)
ccw run code-reviewer --scope "$staged_files" --severity critical,high

if [ $? -ne 0 ]; then
  echo "❌ Code review found critical/high issues. Commit aborted."
  exit 1
fi
```

### CI/CD Integration

```yaml
# .github/workflows/code-review.yml
name: Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Code Review
        run: |
          ccw run code-reviewer --report-level detailed
          ccw report upload .code-review/report.md
```

## Examples

### Example 1: Security-Focused Review

```bash
# Review authentication module for security issues
/code-reviewer --scope src/auth --focus security --severity critical,high
```

### Example 2: Performance Review

```bash
# Review API endpoints for performance issues
/code-reviewer --scope src/api --focus best-practices --check performance
```

### Example 3: Full Project Audit

```bash
# Comprehensive review of entire codebase
/code-reviewer --report-level detailed --output .code-review/audit-2024-01.md
```

## Troubleshooting

### Large Codebase

If review takes too long:
```bash
# Review in batches
/code-reviewer --scope src/module-1
/code-reviewer --scope src/module-2 --resume

# Or use parallel execution
/code-reviewer --parallel 4
```

### False Positives

Configure suppressions in `.code-reviewer.json`:
```json
{
  "suppressions": {
    "security": {
      "sql-injection": {
        "paths": ["src/legacy/**/*"],
        "reason": "Legacy code, scheduled for refactor"
      }
    }
  }
}
```

## Roadmap

- [ ] AI-powered vulnerability detection
- [ ] Integration with popular security scanners (Snyk, SonarQube)
- [ ] Automated fix suggestions with diffs
- [ ] IDE plugins for real-time feedback
- [ ] Custom rule engine for organization-specific policies

## License

MIT License - See LICENSE file for details
