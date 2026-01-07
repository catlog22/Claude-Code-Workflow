# Quality Standards

## Overall Quality Metrics

### Quality Score Formula

```
Overall Quality = (
  Correctness × 0.30 +
  Security × 0.25 +
  Maintainability × 0.20 +
  Performance × 0.15 +
  Documentation × 0.10
)
```

### Score Ranges

| Range | Grade | Description |
|-------|-------|-------------|
| 90-100 | A | Excellent - Production ready |
| 80-89 | B | Good - Minor improvements needed |
| 70-79 | C | Acceptable - Some issues to address |
| 60-69 | D | Poor - Significant improvements required |
| 0-59 | F | Failing - Major issues, not production ready |

## Review Completeness

### Mandatory Checks

**Security**:
- ✅ OWASP Top 10 coverage
- ✅ CWE Top 25 coverage
- ✅ Language-specific security patterns
- ✅ Dependency vulnerability scan

**Code Quality**:
- ✅ Naming convention compliance
- ✅ Complexity analysis
- ✅ Code duplication detection
- ✅ Dead code identification

**Performance**:
- ✅ N+1 query detection
- ✅ Algorithm efficiency check
- ✅ Memory leak detection
- ✅ Resource cleanup verification

**Maintainability**:
- ✅ Documentation coverage
- ✅ Test coverage analysis
- ✅ Dependency health check
- ✅ Error handling review

## Reporting Standards

### Finding Requirements

Each finding must include:
- **Unique ID**: SEC-001, BP-001, etc.
- **Type**: Specific issue type (sql-injection, high-complexity, etc.)
- **Severity**: Critical, High, Medium, Low
- **Location**: File path and line number
- **Code Snippet**: Vulnerable/problematic code
- **Message**: Clear description of the issue
- **Recommendation**: Specific fix guidance
- **Example**: Before/after code example

### Report Structure

**Executive Summary**:
- High-level overview
- Risk assessment
- Key statistics
- Compliance status

**Detailed Findings**:
- Organized by severity
- Grouped by category
- Full details for each finding

**Action Plan**:
- Prioritized fix list
- Effort estimates
- Timeline recommendations

**Metrics Dashboard**:
- Quality scores
- Trend analysis (if historical data)
- Compliance status

**Appendix**:
- Full findings list
- Configuration details
- Tool versions
- References

## Output File Standards

### File Naming

```
.code-review/
├── inventory.json              # File inventory
├── security-findings.json      # Security findings
├── best-practices-findings.json # Best practices findings
├── summary.json                # Summary statistics
├── REPORT.md                   # Main report
├── FIX-CHECKLIST.md           # Action checklist
└── state.json                  # Session state
```

### JSON Schema

**Finding Schema**:
```json
{
  "id": "string",
  "type": "string",
  "category": "security|code_quality|performance|maintainability",
  "severity": "critical|high|medium|low",
  "file": "string",
  "line": "number",
  "column": "number",
  "code": "string",
  "message": "string",
  "recommendation": {
    "description": "string",
    "fix_example": "string"
  },
  "references": ["string"],
  "cwe": "string (optional)",
  "owasp": "string (optional)"
}
```

## Validation Requirements

### Phase Completion Criteria

**Phase 1 (Code Discovery)**:
- ✅ At least 1 file discovered
- ✅ Files categorized by priority
- ✅ Metadata extracted
- ✅ Inventory JSON created

**Phase 2 (Security Analysis)**:
- ✅ All critical/high priority files analyzed
- ✅ Findings have severity classification
- ✅ CWE/OWASP mappings included
- ✅ Fix recommendations provided

**Phase 3 (Best Practices)**:
- ✅ Code quality checks completed
- ✅ Performance analysis done
- ✅ Maintainability assessed
- ✅ Recommendations provided

**Phase 4 (Report Generation)**:
- ✅ All findings consolidated
- ✅ Scores calculated
- ✅ Reports generated
- ✅ Checklist created

## Skill Execution Standards

### Performance Targets

- **Phase 1**: < 30 seconds per 1000 files
- **Phase 2**: < 60 seconds per 100 files (security)
- **Phase 3**: < 60 seconds per 100 files (best practices)
- **Phase 4**: < 10 seconds (report generation)

### Resource Limits

- **Memory**: < 2GB for projects with 1000+ files
- **CPU**: Efficient pattern matching (minimize regex complexity)
- **Disk**: Use streaming for large files (> 10MB)

### Error Handling

**Graceful Degradation**:
- If tool unavailable: Skip check, note in report
- If file unreadable: Log warning, continue with others
- If analysis fails: Report error, continue with next file

**User Notification**:
- Progress updates every 10% completion
- Clear error messages with troubleshooting steps
- Final summary with metrics and file locations

## Integration Standards

### Git Integration

**Pre-commit Hook**:
```bash
#!/bin/bash
ccw run code-reviewer --scope staged --severity critical,high
exit $?  # Block commit if critical/high issues found
```

**PR Comments**:
- Automatic review comments on changed lines
- Summary comment with overall findings
- Status check (pass/fail based on threshold)

### CI/CD Integration

**Requirements**:
- Exit code 0 if no critical/high issues
- Exit code 1 if blocking issues found
- JSON output for parsing
- Configurable severity threshold

### IDE Integration

**LSP Support** (future):
- Real-time security/quality feedback
- Inline fix suggestions
- Quick actions for common fixes

## Compliance Mapping

### Supported Standards

**PCI DSS**:
- Requirement 6.5: Common coding vulnerabilities
- Map findings to specific requirements

**HIPAA**:
- Technical safeguards
- Map data exposure findings

**GDPR**:
- Data protection by design
- Map sensitive data handling

**SOC 2**:
- Security controls
- Map access control findings

### Compliance Reports

Generate compliance-specific reports:
```
.code-review/compliance/
├── pci-dss-report.md
├── hipaa-report.md
├── gdpr-report.md
└── soc2-report.md
```
