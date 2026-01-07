# Security Requirements Specification

## OWASP Top 10 Coverage

### A01:2021 - Broken Access Control

**Checks**:
- Missing authorization checks on protected routes
- Insecure direct object references (IDOR)
- Path traversal vulnerabilities
- Missing CSRF protection
- Elevation of privilege

**Patterns**:
```javascript
// Missing auth middleware
router.get('/admin/*', handler);  // ❌ No auth check

// Insecure direct object reference
router.get('/user/:id', async (req, res) => {
  const user = await User.findById(req.params.id);  // ❌ No ownership check
  res.json(user);
});
```

### A02:2021 - Cryptographic Failures

**Checks**:
- Sensitive data transmitted without encryption
- Weak cryptographic algorithms (MD5, SHA1)
- Hardcoded secrets/keys
- Insecure random number generation

**Patterns**:
```javascript
// Weak hashing
const hash = crypto.createHash('md5').update(password);  // ❌ MD5 is weak

// Hardcoded secret
const token = jwt.sign(payload, 'secret123');  // ❌ Hardcoded secret
```

### A03:2021 - Injection

**Checks**:
- SQL injection
- NoSQL injection
- Command injection
- LDAP injection
- XPath injection

**Patterns**:
```javascript
// SQL injection
const query = `SELECT * FROM users WHERE id = ${userId}`;  // ❌

// Command injection
exec(`git clone ${userRepo}`);  // ❌
```

### A04:2021 - Insecure Design

**Checks**:
- Missing rate limiting
- Lack of input validation
- Business logic flaws
- Missing security requirements

### A05:2021 - Security Misconfiguration

**Checks**:
- Default credentials
- Overly permissive CORS
- Verbose error messages
- Unnecessary features enabled
- Missing security headers

**Patterns**:
```javascript
// Overly permissive CORS
app.use(cors({ origin: '*' }));  // ❌

// Verbose error
res.status(500).json({ error: err.stack });  // ❌
```

### A06:2021 - Vulnerable and Outdated Components

**Checks**:
- Dependencies with known vulnerabilities
- Unmaintained dependencies
- Using deprecated APIs

### A07:2021 - Identification and Authentication Failures

**Checks**:
- Weak password requirements
- Permits brute force attacks
- Exposed session IDs
- Weak JWT implementation

**Patterns**:
```javascript
// Weak bcrypt rounds
bcrypt.hash(password, 4);  // ❌ Too low (min: 10)

// Session ID in URL
res.redirect(`/dashboard?sessionId=${sessionId}`);  // ❌
```

### A08:2021 - Software and Data Integrity Failures

**Checks**:
- Insecure deserialization
- Unsigned/unverified updates
- CI/CD pipeline vulnerabilities

**Patterns**:
```javascript
// Insecure deserialization
const obj = eval(userInput);  // ❌

// Pickle vulnerability (Python)
data = pickle.loads(untrusted_data)  # ❌
```

### A09:2021 - Security Logging and Monitoring Failures

**Checks**:
- Missing audit logs
- Sensitive data in logs
- Insufficient monitoring

**Patterns**:
```javascript
// Password in logs
console.log(`Login attempt: ${username}:${password}`);  // ❌
```

### A10:2021 - Server-Side Request Forgery (SSRF)

**Checks**:
- Unvalidated URLs in requests
- Internal network access
- Cloud metadata exposure

**Patterns**:
```javascript
// SSRF vulnerability
const response = await fetch(userProvidedUrl);  // ❌
```

## CWE Top 25 Coverage

### CWE-79: Cross-site Scripting (XSS)

**Patterns**:
```javascript
element.innerHTML = userInput;  // ❌
document.write(userInput);  // ❌
```

### CWE-89: SQL Injection

**Patterns**:
```javascript
query = `SELECT * FROM users WHERE name = '${name}'`;  // ❌
```

### CWE-20: Improper Input Validation

**Checks**:
- Missing input sanitization
- No input length limits
- Unvalidated file uploads

### CWE-78: OS Command Injection

**Patterns**:
```javascript
exec(`ping ${userInput}`);  // ❌
```

### CWE-190: Integer Overflow

**Checks**:
- Large number operations without bounds checking
- Array allocation with user-controlled size

## Language-Specific Security Rules

### TypeScript/JavaScript

- Prototype pollution
- eval() usage
- Unsafe regex (ReDoS)
- require() with dynamic input

### Python

- pickle vulnerabilities
- yaml.unsafe_load()
- SQL injection in SQLAlchemy
- Command injection in subprocess

### Java

- Deserialization vulnerabilities
- XXE in XML parsers
- Path traversal
- SQL injection in JDBC

### Go

- Race conditions
- SQL injection
- Path traversal
- Weak cryptography

## Severity Classification

### Critical
- Remote code execution
- SQL injection with write access
- Authentication bypass
- Hardcoded credentials in production

### High
- XSS in sensitive contexts
- Missing authorization checks
- Sensitive data exposure
- Insecure cryptography

### Medium
- Missing rate limiting
- Weak password policy
- Security misconfiguration
- Information disclosure

### Low
- Missing security headers
- Verbose error messages
- Outdated dependencies (no known exploits)
