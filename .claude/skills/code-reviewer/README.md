# Code Reviewer Skill

A comprehensive code review skill for identifying security vulnerabilities and best practices violations.

## Overview

The **code-reviewer** skill provides automated code review capabilities covering:
- **Security Analysis**: OWASP Top 10, CWE Top 25, language-specific vulnerabilities
- **Code Quality**: Naming conventions, complexity, duplication, dead code
- **Performance**: N+1 queries, inefficient algorithms, memory leaks
- **Maintainability**: Documentation, test coverage, dependency health

## Quick Start

### Basic Usage

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

# Generate detailed report
/code-reviewer --report-level detailed

# Resume from previous session
/code-reviewer --resume
```

## Features

### Security Analysis

✅ **OWASP Top 10 2021 Coverage**
- Injection vulnerabilities (SQL, Command, XSS)
- Authentication & authorization flaws
- Sensitive data exposure
- Security misconfiguration
- And more...

✅ **CWE Top 25 Coverage**
- Cross-site scripting (CWE-79)
- SQL injection (CWE-89)
- Command injection (CWE-78)
- Input validation (CWE-20)
- And more...

✅ **Language-Specific Checks**
- JavaScript/TypeScript: prototype pollution, eval usage
- Python: pickle vulnerabilities, command injection
- Java: deserialization, XXE
- Go: race conditions, memory leaks

### Best Practices Review

✅ **Code Quality**
- Naming convention compliance
- Cyclomatic complexity analysis
- Code duplication detection
- Dead code identification

✅ **Performance**
- N+1 query detection
- Inefficient algorithm patterns
- Memory leak detection
- Resource cleanup verification

✅ **Maintainability**
- Documentation coverage
- Test coverage analysis
- Dependency health check
- Error handling review

## Output

The skill generates comprehensive reports in `.code-review/` directory:

```
.code-review/
├── inventory.json              # File inventory with metadata
├── security-findings.json      # Security vulnerabilities
├── best-practices-findings.json # Best practices violations
├── summary.json                # Summary statistics
├── REPORT.md                   # Comprehensive markdown report
└── FIX-CHECKLIST.md           # Actionable fix checklist
```

### Report Contents

**REPORT.md** includes:
- Executive summary with risk assessment
- Quality scores (Security, Code Quality, Performance, Maintainability)
- Detailed findings organized by severity
- Code examples with fix recommendations
- Action plan prioritized by urgency
- Compliance status (PCI DSS, HIPAA, GDPR, SOC 2)

**FIX-CHECKLIST.md** provides:
- Checklist format for tracking fixes
- Organized by severity (Critical → Low)
- Effort estimates for each issue
- Priority assignments

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

## Workflow

### Phase 1: Code Discovery
- Discover and categorize code files
- Extract metadata (LOC, complexity, framework)
- Prioritize files (Critical, High, Medium, Low)

### Phase 2: Security Analysis
- Scan for OWASP Top 10 vulnerabilities
- Check CWE Top 25 weaknesses
- Apply language-specific security patterns
- Generate security findings

### Phase 3: Best Practices Review
- Analyze code quality issues
- Detect performance problems
- Assess maintainability concerns
- Generate best practices findings

### Phase 4: Report Generation
- Consolidate all findings
- Calculate quality scores
- Generate comprehensive reports
- Create actionable checklists

## Integration

### Pre-commit Hook

Block commits with critical/high issues:

```bash
#!/bin/bash
# .git/hooks/pre-commit

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

**Output**: Security findings with OWASP/CWE mappings and fix recommendations

### Example 2: Performance Review

```bash
# Review API endpoints for performance issues
/code-reviewer --scope src/api --focus best-practices --check performance
```

**Output**: N+1 queries, inefficient algorithms, memory leak detections

### Example 3: Full Project Audit

```bash
# Comprehensive review of entire codebase
/code-reviewer --report-level detailed --output .code-review/audit-2024-01.md
```

**Output**: Complete audit with all findings, scores, and action plan

## Compliance Support

The skill maps findings to compliance requirements:

- **PCI DSS**: Requirement 6.5 (Common coding vulnerabilities)
- **HIPAA**: Technical safeguards and access controls
- **GDPR**: Article 32 (Security of processing)
- **SOC 2**: Security controls and monitoring

## Architecture

### Execution Mode
**Sequential** - Fixed phase order for systematic review:
1. Code Discovery → 2. Security Analysis → 3. Best Practices → 4. Report Generation

### Tools Used
- `mcp__ace-tool__search_context` - Semantic code search
- `mcp__ccw-tools__smart_search` - Pattern matching
- `Read` - File content access
- `Write` - Report generation

## Quality Standards

### Scoring System

```
Overall Score = (
  Security Score × 0.4 +
  Code Quality Score × 0.25 +
  Performance Score × 0.2 +
  Maintainability Score × 0.15
)
```

### Score Ranges
- **A (90-100)**: Excellent - Production ready
- **B (80-89)**: Good - Minor improvements needed
- **C (70-79)**: Acceptable - Some issues to address
- **D (60-69)**: Poor - Significant improvements required
- **F (0-59)**: Failing - Major issues, not production ready

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

## File Structure

```
.claude/skills/code-reviewer/
├── SKILL.md                    # Main skill documentation
├── README.md                   # This file
├── phases/
│   ├── 01-code-discovery.md
│   ├── 02-security-analysis.md
│   ├── 03-best-practices-review.md
│   └── 04-report-generation.md
├── specs/
│   ├── security-requirements.md
│   ├── best-practices-requirements.md
│   └── quality-standards.md
└── templates/
    ├── security-finding.md
    ├── best-practice-finding.md
    └── report-template.md
```

## Version

**v1.0.0** - Initial release

## License

MIT License
