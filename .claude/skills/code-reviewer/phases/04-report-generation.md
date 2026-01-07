# Phase 4: Report Generation

## Objective

Consolidate security and best practices findings into a comprehensive, actionable code review report.

## Input

- **Security Findings**: `.code-review/security-findings.json`
- **Best Practices Findings**: `.code-review/best-practices-findings.json`
- **File Inventory**: `.code-review/inventory.json`

## Process

### Step 1: Load All Findings

```javascript
const securityFindings = JSON.parse(
  await Read({ file_path: '.code-review/security-findings.json' })
);
const bestPracticesFindings = JSON.parse(
  await Read({ file_path: '.code-review/best-practices-findings.json' })
);
const inventory = JSON.parse(
  await Read({ file_path: '.code-review/inventory.json' })
);
```

### Step 2: Aggregate Statistics

```javascript
const stats = {
  total_files_reviewed: inventory.total_files,
  total_findings: securityFindings.total_findings + bestPracticesFindings.total_findings,
  by_severity: {
    critical: securityFindings.by_severity.critical,
    high: securityFindings.by_severity.high + bestPracticesFindings.by_severity.high,
    medium: securityFindings.by_severity.medium + bestPracticesFindings.by_severity.medium,
    low: securityFindings.by_severity.low + bestPracticesFindings.by_severity.low,
  },
  by_category: {
    security: securityFindings.total_findings,
    code_quality: bestPracticesFindings.by_category.code_quality,
    performance: bestPracticesFindings.by_category.performance,
    maintainability: bestPracticesFindings.by_category.maintainability,
  }
};
```

### Step 3: Generate Comprehensive Report

```markdown
# Comprehensive Code Review Report

**Generated**: {timestamp}
**Scope**: {scope}
**Files Reviewed**: {total_files}
**Total Findings**: {total_findings}

## Executive Summary

{Provide high-level overview of code health}

### Risk Assessment

{Calculate risk score based on findings}

### Compliance Status

{Map findings to compliance requirements}

## Detailed Findings

{Merge and organize security + best practices findings}

## Action Plan

{Prioritized list of fixes with effort estimates}

## Appendix

{Technical details, references, configuration}
```

### Step 4: Generate Fix Tracking Checklist

Create actionable checklist for developers:

```markdown
# Code Review Fix Checklist

## Critical Issues (Fix Immediately)

- [ ] [SEC-001] SQL Injection in src/auth/user-service.ts:145
- [ ] [SEC-002] Hardcoded JWT Secret in src/auth/jwt.ts:23
- [ ] [SEC-003] XSS Vulnerability in src/api/comments.ts:89

## High Priority Issues (Fix This Week)

- [ ] [SEC-004] Missing Authorization Check in src/api/admin.ts:34
- [ ] [BP-001] N+1 Query Pattern in src/api/orders.ts:45
...
```

### Step 5: Generate Metrics Dashboard

```markdown
## Code Health Metrics

### Security Score: 68/100
- Critical Issues: 3 (-30 points)
- High Issues: 8 (-2 points each)

### Code Quality Score: 75/100
- High Complexity Functions: 2
- Code Duplication: 5%
- Dead Code: 3 instances

### Performance Score: 82/100
- N+1 Queries: 3
- Inefficient Algorithms: 2

### Maintainability Score: 70/100
- Documentation Coverage: 65%
- Test Coverage: 72%
- Missing Tests: 5 files
```

## Output

### Main Report

Save to `.code-review/REPORT.md`:

- Executive summary
- Detailed findings (security + best practices)
- Action plan with priorities
- Metrics and scores
- References and compliance mapping

### Fix Checklist

Save to `.code-review/FIX-CHECKLIST.md`:

- Organized by severity
- Checkboxes for tracking
- File:line references
- Effort estimates

### JSON Summary

Save to `.code-review/summary.json`:

```json
{
  "report_date": "2024-01-15T12:00:00Z",
  "scope": "src/**/*",
  "statistics": {
    "total_files": 247,
    "total_findings": 69,
    "by_severity": { "critical": 3, "high": 13, "medium": 30, "low": 23 },
    "by_category": {
      "security": 24,
      "code_quality": 18,
      "performance": 12,
      "maintainability": 15
    }
  },
  "scores": {
    "security": 68,
    "code_quality": 75,
    "performance": 82,
    "maintainability": 70,
    "overall": 74
  },
  "risk_level": "MEDIUM",
  "action_required": true
}
```

## Report Template

Full report includes:

1. **Executive Summary**
   - Overall code health
   - Risk assessment
   - Key recommendations

2. **Security Findings** (from Phase 2)
   - Critical/High/Medium/Low
   - OWASP/CWE mappings
   - Fix recommendations with code examples

3. **Best Practices Findings** (from Phase 3)
   - Code quality issues
   - Performance concerns
   - Maintainability gaps

4. **Metrics Dashboard**
   - Security score
   - Code quality score
   - Performance score
   - Maintainability score

5. **Action Plan**
   - Immediate actions (critical)
   - Short-term (1 week)
   - Medium-term (1 month)
   - Long-term (3 months)

6. **Compliance Impact**
   - PCI DSS findings
   - HIPAA findings
   - GDPR findings
   - SOC 2 findings

7. **Appendix**
   - Full findings list
   - Configuration used
   - Tools and versions
   - References

## State Management

```json
{
  "phase": "04-report-generation",
  "status": "completed",
  "timestamp": "2024-01-15T12:00:00Z",
  "input": {
    "security_findings": ".code-review/security-findings.json",
    "best_practices_findings": ".code-review/best-practices-findings.json"
  },
  "output": {
    "report": ".code-review/REPORT.md",
    "checklist": ".code-review/FIX-CHECKLIST.md",
    "summary": ".code-review/summary.json"
  }
}
```

## Agent Instructions

```markdown
You are in Phase 4 (FINAL) of the Code Review workflow. Generate comprehensive report.

**Instructions**:
1. Load security findings from Phase 2
2. Load best practices findings from Phase 3
3. Aggregate statistics and calculate scores
4. Generate comprehensive markdown report
5. Create fix tracking checklist
6. Generate JSON summary
7. Inform user of completion and output locations

**Tools Available**:
- Read (load findings)
- Write (save reports)

**Output Requirements**:
- REPORT.md (comprehensive markdown report)
- FIX-CHECKLIST.md (actionable checklist)
- summary.json (machine-readable summary)
- All files in .code-review/ directory
```

## Validation

- ✅ All findings consolidated
- ✅ Scores calculated
- ✅ Action plan generated
- ✅ Reports saved to .code-review/
- ✅ User notified of completion

## Completion

Code review complete! Outputs available in `.code-review/` directory.
