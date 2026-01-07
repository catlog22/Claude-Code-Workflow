# Report Template

## Main Report Structure (REPORT.md)

```markdown
# Code Review Report

**Generated**: {timestamp}
**Scope**: {scope}
**Files Reviewed**: {total_files}
**Total Findings**: {total_findings}

---

## 📊 Executive Summary

### Overall Assessment

{Brief 2-3 paragraph assessment of code health}

### Risk Level: {LOW|MEDIUM|HIGH|CRITICAL}

{Risk assessment based on findings severity and count}

### Key Statistics

| Metric | Value | Status |
|--------|-------|--------|
| Total Files | {count} | - |
| Files with Issues | {count} | {percentage}% |
| Critical Findings | {count} | {icon} |
| High Findings | {count} | {icon} |
| Medium Findings | {count} | {icon} |
| Low Findings | {count} | {icon} |

### Category Breakdown

| Category | Count | Percentage |
|----------|-------|------------|
| Security | {count} | {percentage}% |
| Code Quality | {count} | {percentage}% |
| Performance | {count} | {percentage}% |
| Maintainability | {count} | {percentage}% |

---

## 🎯 Quality Scores

### Security Score: {score}/100
{Assessment and key issues}

### Code Quality Score: {score}/100
{Assessment and key issues}

### Performance Score: {score}/100
{Assessment and key issues}

### Maintainability Score: {score}/100
{Assessment and key issues}

### Overall Score: {score}/100

**Grade**: {A|B|C|D|F}

---

## 🔴 Critical Findings (Requires Immediate Action)

{List all critical findings using security-finding.md template}

---

## 🟠 High Priority Findings

{List all high findings}

---

## 🟡 Medium Priority Findings

{List all medium findings}

---

## 🟢 Low Priority Findings

{List all low findings}

---

## 📋 Action Plan

### Immediate (Within 24 hours)
1. {Critical issue 1}
2. {Critical issue 2}
3. {Critical issue 3}

### Short-term (Within 1 week)
1. {High priority issue 1}
2. {High priority issue 2}
...

### Medium-term (Within 1 month)
1. {Medium priority issue 1}
2. {Medium priority issue 2}
...

### Long-term (Within 3 months)
1. {Low priority issue 1}
2. {Improvement initiative 1}
...

---

## 📊 Metrics Dashboard

### Code Health Trends

{If historical data available, show trends}

### File Hotspots

Top files with most issues:
1. `{file-path}` - {count} issues ({severity breakdown})
2. `{file-path}` - {count} issues
...

### Technology Breakdown

Issues by language/framework:
- TypeScript: {count} issues
- Python: {count} issues
...

---

## ✅ Compliance Status

### PCI DSS
- **Status**: {COMPLIANT|NON-COMPLIANT|PARTIAL}
- **Affecting Findings**: {list}

### HIPAA
- **Status**: {COMPLIANT|NON-COMPLIANT|PARTIAL}
- **Affecting Findings**: {list}

### GDPR
- **Status**: {COMPLIANT|NON-COMPLIANT|PARTIAL}
- **Affecting Findings**: {list}

---

## 📚 Appendix

### A. Review Configuration

\`\`\`json
{review-config}
\`\`\`

### B. Tools and Versions

- Code Reviewer Skill: v1.0.0
- Security Rules: OWASP Top 10 2021, CWE Top 25
- Languages Analyzed: {list}

### C. References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- {additional references}

### D. Full Findings Index

{Links to detailed finding JSONs}
```

---

## Fix Checklist Template (FIX-CHECKLIST.md)

```markdown
# Code Review Fix Checklist

**Generated**: {timestamp}
**Total Items**: {count}

---

## 🔴 Critical Issues (Fix Immediately)

- [ ] **[SEC-001]** SQL Injection in `src/auth/user-service.ts:145`
      - Effort: 1 hour
      - Priority: P0
      - Assignee: ___________

- [ ] **[SEC-002]** Hardcoded JWT Secret in `src/auth/jwt.ts:23`
      - Effort: 30 minutes
      - Priority: P0
      - Assignee: ___________

---

## 🟠 High Priority Issues (Fix This Week)

- [ ] **[SEC-003]** Missing Authorization in `src/api/admin.ts:34`
      - Effort: 2 hours
      - Priority: P1
      - Assignee: ___________

- [ ] **[BP-001]** N+1 Query in `src/api/orders.ts:45`
      - Effort: 1 hour
      - Priority: P1
      - Assignee: ___________

---

## 🟡 Medium Priority Issues (Fix This Month)

{List medium priority items}

---

## 🟢 Low Priority Issues (Fix Next Release)

{List low priority items}

---

## Progress Tracking

**Overall Progress**: {completed}/{total} ({percentage}%)

- Critical: {completed}/{total}
- High: {completed}/{total}
- Medium: {completed}/{total}
- Low: {completed}/{total}

**Estimated Total Effort**: {hours} hours
**Estimated Completion**: {date}
```

---

## Summary JSON Template (summary.json)

```json
{
  "report_date": "2024-01-15T12:00:00Z",
  "scope": "src/**/*",
  "statistics": {
    "total_files": 247,
    "files_with_issues": 89,
    "total_findings": 69,
    "by_severity": {
      "critical": 3,
      "high": 13,
      "medium": 30,
      "low": 23
    },
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
  "grade": "C",
  "risk_level": "MEDIUM",
  "action_required": true,
  "compliance": {
    "pci_dss": {
      "status": "NON_COMPLIANT",
      "affecting_findings": ["SEC-001", "SEC-002", "SEC-008", "SEC-011"]
    },
    "hipaa": {
      "status": "NON_COMPLIANT",
      "affecting_findings": ["SEC-005", "SEC-009"]
    },
    "gdpr": {
      "status": "PARTIAL",
      "affecting_findings": ["SEC-002", "SEC-005", "SEC-007"]
    }
  },
  "top_issues": [
    {
      "id": "SEC-001",
      "type": "sql-injection",
      "severity": "critical",
      "file": "src/auth/user-service.ts",
      "line": 145
    }
  ],
  "hotspots": [
    {
      "file": "src/auth/user-service.ts",
      "issues": 5,
      "severity_breakdown": { "critical": 1, "high": 2, "medium": 2 }
    }
  ],
  "effort_estimate": {
    "critical": 4.5,
    "high": 18,
    "medium": 35,
    "low": 12,
    "total_hours": 69.5
  }
}
```
