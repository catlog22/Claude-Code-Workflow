# Phase 2: Security Analysis

## Objective

Analyze code files for security vulnerabilities based on OWASP Top 10, CWE Top 25, and language-specific security patterns.

## Input

- **File Inventory**: From Phase 1 (`.code-review/inventory.json`)
- **Priority Focus**: Critical and High priority files (unless `--scope all`)
- **User Arguments**:
  - `--focus security`: Security-only mode
  - `--severity critical,high,medium,low`: Minimum severity to report
  - `--checks`: Specific security checks to run (e.g., sql-injection, xss)

## Process

### Step 1: Load Security Rules

```javascript
// Load security check definitions
const securityRules = {
  owasp_top_10: [
    'injection',
    'broken_authentication',
    'sensitive_data_exposure',
    'xxe',
    'broken_access_control',
    'security_misconfiguration',
    'xss',
    'insecure_deserialization',
    'vulnerable_components',
    'insufficient_logging'
  ],
  cwe_top_25: [
    'cwe-79',  // XSS
    'cwe-89',  // SQL Injection
    'cwe-20',  // Improper Input Validation
    'cwe-78',  // OS Command Injection
    'cwe-190', // Integer Overflow
    // ... more CWE checks
  ]
};

// Load language-specific rules
const languageRules = {
  typescript: require('./rules/typescript-security.json'),
  python: require('./rules/python-security.json'),
  java: require('./rules/java-security.json'),
  go: require('./rules/go-security.json'),
};
```

### Step 2: Analyze Files for Vulnerabilities

For each file in the inventory, perform security analysis:

```javascript
const findings = [];

for (const file of inventory.files) {
  if (file.priority !== 'critical' && file.priority !== 'high') continue;

  // Read file content
  const content = await Read({ file_path: file.path });

  // Run security checks
  const fileFindings = await runSecurityChecks(content, file, {
    rules: securityRules,
    languageRules: languageRules[file.language],
    severity: args.severity || 'medium'
  });

  findings.push(...fileFindings);
}
```

### Step 3: Security Check Patterns

#### A. Injection Vulnerabilities

**SQL Injection**:
```javascript
// Pattern: String concatenation in SQL queries
const sqlInjectionPatterns = [
  /\$\{.*\}.*SELECT/,                    // Template literal with SELECT
  /"SELECT.*\+\s*\w+/,                   // String concatenation
  /execute\([`'"].*\$\{.*\}.*[`'"]\)/,   // Parameterized query bypass
  /query\(.*\+.*\)/,                     // Query concatenation
];

// Check code
for (const pattern of sqlInjectionPatterns) {
  const matches = content.matchAll(new RegExp(pattern, 'g'));
  for (const match of matches) {
    findings.push({
      type: 'sql-injection',
      severity: 'critical',
      line: getLineNumber(content, match.index),
      code: match[0],
      file: file.path,
      message: 'Potential SQL injection vulnerability',
      recommendation: 'Use parameterized queries or ORM methods',
      cwe: 'CWE-89',
      owasp: 'A03:2021 - Injection'
    });
  }
}
```

**Command Injection**:
```javascript
// Pattern: Unsanitized input in exec/spawn
const commandInjectionPatterns = [
  /exec\(.*\$\{.*\}/,                    // exec with template literal
  /spawn\(.*,\s*\[.*\$\{.*\}.*\]\)/,    // spawn with unsanitized args
  /execSync\(.*\+.*\)/,                  // execSync with concatenation
];
```

**XSS (Cross-Site Scripting)**:
```javascript
// Pattern: Unsanitized user input in DOM/HTML
const xssPatterns = [
  /innerHTML\s*=.*\$\{.*\}/,             // innerHTML with template literal
  /dangerouslySetInnerHTML/,             // React dangerous prop
  /document\.write\(.*\)/,               // document.write
  /<\w+.*\$\{.*\}.*>/,                   // JSX with unsanitized data
];
```

#### B. Authentication & Authorization

```javascript
// Pattern: Weak authentication
const authPatterns = [
  /password\s*===?\s*['"]/,              // Hardcoded password comparison
  /jwt\.sign\(.*,\s*['"][^'"]{1,16}['"]\)/, // Weak JWT secret
  /bcrypt\.hash\(.*,\s*[1-9]\s*\)/,      // Low bcrypt rounds
  /md5\(.*password.*\)/,                 // MD5 for passwords
  /if\s*\(\s*user\s*\)\s*\{/,            // Missing auth check
];

// Check for missing authorization
const authzPatterns = [
  /router\.(get|post|put|delete)\(.*\)\s*=>/,  // No middleware
  /app\.use\([^)]*\)\s*;(?!.*auth)/,           // Missing auth middleware
];
```

#### C. Sensitive Data Exposure

```javascript
// Pattern: Sensitive data in logs/responses
const sensitiveDataPatterns = [
  /(password|secret|token|key)\s*:/i,    // Sensitive keys in objects
  /console\.log\(.*password.*\)/i,       // Password in logs
  /res\.send\(.*user.*password.*\)/,     // Password in response
  /(api_key|apikey)\s*=\s*['"]/i,        // Hardcoded API keys
];
```

#### D. Security Misconfiguration

```javascript
// Pattern: Insecure configurations
const misconfigPatterns = [
  /cors\(\{.*origin:\s*['"]?\*['"]?.*\}\)/, // CORS wildcard
  /https?\s*:\s*false/,                   // HTTPS disabled
  /helmet\(\)/,                            // Missing helmet config
  /strictMode\s*:\s*false/,               // Strict mode disabled
];
```

### Step 4: Language-Specific Checks

**TypeScript/JavaScript**:
```javascript
const jsFindings = [
  checkPrototypePollution(content),
  checkEvalUsage(content),
  checkUnsafeRegex(content),
  checkWeakCrypto(content),
];
```

**Python**:
```javascript
const pythonFindings = [
  checkPickleVulnerabilities(content),
  checkYamlUnsafeLoad(content),
  checkSqlAlchemy(content),
  checkFlaskSecurityHeaders(content),
];
```

**Java**:
```javascript
const javaFindings = [
  checkDeserialization(content),
  checkXXE(content),
  checkPathTraversal(content),
  checkSQLInjection(content),
];
```

**Go**:
```javascript
const goFindings = [
  checkRaceConditions(content),
  checkSQLInjection(content),
  checkPathTraversal(content),
  checkCryptoWeakness(content),
];
```

## Output

### Security Findings File

Save to `.code-review/security-findings.json`:

```json
{
  "scan_date": "2024-01-15T11:00:00Z",
  "total_findings": 24,
  "by_severity": {
    "critical": 3,
    "high": 8,
    "medium": 10,
    "low": 3
  },
  "by_category": {
    "injection": 5,
    "authentication": 3,
    "data_exposure": 4,
    "misconfiguration": 6,
    "xss": 3,
    "other": 3
  },
  "findings": [
    {
      "id": "SEC-001",
      "type": "sql-injection",
      "severity": "critical",
      "file": "src/auth/user-service.ts",
      "line": 145,
      "column": 12,
      "code": "const query = `SELECT * FROM users WHERE username = '${username}'`;",
      "message": "SQL Injection vulnerability: User input directly concatenated in SQL query",
      "cwe": "CWE-89",
      "owasp": "A03:2021 - Injection",
      "recommendation": {
        "description": "Use parameterized queries to prevent SQL injection",
        "fix_example": "const query = 'SELECT * FROM users WHERE username = ?';\ndb.execute(query, [username]);"
      },
      "references": [
        "https://owasp.org/www-community/attacks/SQL_Injection",
        "https://cwe.mitre.org/data/definitions/89.html"
      ]
    }
  ]
}
```

### Security Report

Generate markdown report:

```markdown
# Security Analysis Report

**Scan Date**: 2024-01-15 11:00:00
**Files Analyzed**: 57 (Critical + High priority)
**Total Findings**: 24

## Severity Summary

| Severity | Count | Percentage |
|----------|-------|------------|
| Critical | 3     | 12.5%      |
| High     | 8     | 33.3%      |
| Medium   | 10    | 41.7%      |
| Low      | 3     | 12.5%      |

## Critical Findings (Requires Immediate Action)

### 🔴 [SEC-001] SQL Injection in User Authentication

**File**: `src/auth/user-service.ts:145`
**CWE**: CWE-89 | **OWASP**: A03:2021 - Injection

**Vulnerable Code**:
\`\`\`typescript
const query = \`SELECT * FROM users WHERE username = '\${username}'\`;
const user = await db.execute(query);
\`\`\`

**Issue**: User input (`username`) is directly concatenated into SQL query, allowing attackers to inject malicious SQL commands.

**Attack Example**:
\`\`\`
username: ' OR '1'='1' --
Result: SELECT * FROM users WHERE username = '' OR '1'='1' --'
Effect: Bypasses authentication, returns all users
\`\`\`

**Recommended Fix**:
\`\`\`typescript
// Use parameterized queries
const query = 'SELECT * FROM users WHERE username = ?';
const user = await db.execute(query, [username]);

// Or use ORM
const user = await User.findOne({ where: { username } });
\`\`\`

**References**:
- [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)
- [CWE-89](https://cwe.mitre.org/data/definitions/89.html)

---

### 🔴 [SEC-002] Hardcoded JWT Secret

**File**: `src/auth/jwt.ts:23`
**CWE**: CWE-798 | **OWASP**: A07:2021 - Identification and Authentication Failures

**Vulnerable Code**:
\`\`\`typescript
const token = jwt.sign(payload, 'mysecret123', { expiresIn: '1h' });
\`\`\`

**Issue**: JWT secret is hardcoded and weak (only 11 characters).

**Recommended Fix**:
\`\`\`typescript
// Use environment variable with strong secret
const token = jwt.sign(payload, process.env.JWT_SECRET, {
  expiresIn: '1h',
  algorithm: 'HS256'
});

// Generate strong secret (32+ bytes):
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
\`\`\`

---

## High Findings

### 🟠 [SEC-003] Missing Input Validation

**File**: `src/api/users.ts:67`
**CWE**: CWE-20 | **OWASP**: A03:2021 - Injection

...

## Medium Findings

...

## Remediation Priority

1. **Critical (3)**: Fix within 24 hours
2. **High (8)**: Fix within 1 week
3. **Medium (10)**: Fix within 1 month
4. **Low (3)**: Fix in next release

## Compliance Impact

- **PCI DSS**: 4 findings affect compliance (SEC-001, SEC-002, SEC-008, SEC-011)
- **HIPAA**: 2 findings affect compliance (SEC-005, SEC-009)
- **GDPR**: 3 findings affect compliance (SEC-002, SEC-005, SEC-007)
```

## State Management

```json
{
  "phase": "02-security-analysis",
  "status": "completed",
  "timestamp": "2024-01-15T11:15:00Z",
  "input": {
    "inventory_path": ".code-review/inventory.json",
    "files_analyzed": 57
  },
  "output": {
    "findings_path": ".code-review/security-findings.json",
    "total_findings": 24,
    "critical_count": 3,
    "high_count": 8
  }
}
```

## Agent Instructions

```markdown
You are in Phase 2 of the Code Review workflow. Your task is to analyze code for security vulnerabilities.

**Instructions**:
1. Load file inventory from Phase 1
2. Focus on Critical + High priority files
3. Run security checks for:
   - OWASP Top 10 vulnerabilities
   - CWE Top 25 weaknesses
   - Language-specific security patterns
4. Use smart_search with mode="ripgrep" for pattern matching
5. Use mcp__ace-tool__search_context for semantic security pattern discovery
6. Classify findings by severity (Critical/High/Medium/Low)
7. Generate security-findings.json and markdown report
8. Proceed to Phase 3 (Best Practices Review)

**Tools Available**:
- mcp__ccw_tools__smart_search (pattern search)
- mcp__ace-tool__search_context (semantic search)
- Read (read file content)
- Write (save findings and reports)
- Grep (targeted pattern matching)

**Output Requirements**:
- security-findings.json with detailed findings
- Security report in markdown format
- Each finding must include: file, line, severity, CWE, OWASP, fix recommendation
- State file for phase tracking
```

## Validation

Before proceeding to Phase 3:

- ✅ All Critical + High priority files analyzed
- ✅ Findings categorized by severity
- ✅ Each finding has fix recommendation
- ✅ CWE and OWASP mappings included
- ✅ Security report generated
- ✅ State saved

## Next Phase

**Phase 3: Best Practices Review** - Analyze code quality, performance, and maintainability issues.
