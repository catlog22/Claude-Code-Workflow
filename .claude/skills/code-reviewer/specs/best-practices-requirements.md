# Best Practices Requirements Specification

## Code Quality Standards

### Naming Conventions

**TypeScript/JavaScript**:
- Classes/Interfaces: PascalCase (`UserService`, `IUserRepository`)
- Functions/Methods: camelCase (`getUserById`, `validateEmail`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`, `API_BASE_URL`)
- Private properties: prefix with `_` or `#` (`_cache`, `#secretKey`)

**Python**:
- Classes: PascalCase (`UserService`, `DatabaseConnection`)
- Functions: snake_case (`get_user_by_id`, `validate_email`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`)
- Private: prefix with `_` (`_internal_cache`)

**Java**:
- Classes/Interfaces: PascalCase (`UserService`, `IUserRepository`)
- Methods: camelCase (`getUserById`, `validateEmail`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`)
- Packages: lowercase (`com.example.service`)

### Function Complexity

**Cyclomatic Complexity Thresholds**:
- **Low**: 1-5 (simple functions, easy to test)
- **Medium**: 6-10 (acceptable, well-structured)
- **High**: 11-20 (needs refactoring)
- **Very High**: 21+ (critical, must refactor)

**Calculation**:
```
Complexity = 1 (base) 
  + count(if)
  + count(else if)
  + count(while)
  + count(for)
  + count(case)
  + count(catch)
  + count(&&)
  + count(||)
  + count(? :)
```

### Code Duplication

**Thresholds**:
- **Acceptable**: < 3% duplication
- **Warning**: 3-5% duplication
- **Critical**: > 5% duplication

**Detection**:
- Minimum block size: 5 lines
- Similarity threshold: 85%
- Ignore: Comments, imports, trivial getters/setters

### Dead Code Detection

**Targets**:
- Unused imports
- Unused variables/functions (not exported)
- Unreachable code (after return/throw)
- Commented-out code blocks (> 5 lines)

## Performance Standards

### N+1 Query Prevention

**Anti-patterns**:
```javascript
// ❌ N+1 Query
for (const order of orders) {
  const user = await User.findById(order.userId);
}

// ✅ Batch Query
const userIds = orders.map(o => o.userId);
const users = await User.findByIds(userIds);
```

### Algorithm Efficiency

**Common Issues**:
- Nested loops (O(n²)) when O(n) possible
- Array.indexOf in loop → use Set.has()
- Array.filter().length → use Array.some()
- Multiple array iterations → combine into one pass

**Acceptable Complexity**:
- **O(1)**: Ideal for lookups
- **O(log n)**: Good for search
- **O(n)**: Acceptable for linear scan
- **O(n log n)**: Acceptable for sorting
- **O(n²)**: Avoid if possible, document if necessary

### Memory Leak Prevention

**Common Issues**:
- Event listeners without cleanup
- setInterval without clearInterval
- Global variable accumulation
- Circular references
- Large array/object allocations

**Patterns**:
```javascript
// ❌ Memory Leak
element.addEventListener('click', handler);
// No cleanup

// ✅ Proper Cleanup
useEffect(() => {
  element.addEventListener('click', handler);
  return () => element.removeEventListener('click', handler);
}, []);
```

### Resource Cleanup

**Required Cleanup**:
- Database connections
- File handles
- Network sockets
- Timers (setTimeout, setInterval)
- Event listeners

## Maintainability Standards

### Documentation Requirements

**Required for**:
- All exported functions/classes
- Public APIs
- Complex algorithms
- Non-obvious business logic

**JSDoc Format**:
```javascript
/**
 * Validates user credentials and generates JWT token
 * 
 * @param {string} username - User's username or email
 * @param {string} password - Plain text password
 * @returns {Promise<{token: string, expiresAt: Date}>} JWT token and expiration
 * @throws {AuthenticationError} If credentials are invalid
 * 
 * @example
 * const {token} = await authenticateUser('john@example.com', 'secret123');
 */
async function authenticateUser(username, password) {
  // ...
}
```

**Coverage Targets**:
- Critical modules: 100%
- High priority: 90%
- Medium priority: 70%
- Low priority: 50%

### Test Coverage Requirements

**Coverage Targets**:
- Unit tests: 80% line coverage
- Integration tests: Key workflows covered
- E2E tests: Critical user paths covered

**Required Tests**:
- All exported functions
- All public methods
- Error handling paths
- Edge cases

**Test File Convention**:
```
src/auth/login.ts
  → src/auth/login.test.ts (unit)
  → src/auth/login.integration.test.ts (integration)
```

### Dependency Management

**Best Practices**:
- Pin major versions (`"^1.2.3"` not `"*"`)
- Avoid 0.x versions in production
- Regular security audits (npm audit, snyk)
- Keep dependencies up-to-date
- Minimize dependency count

**Version Pinning**:
```json
{
  "dependencies": {
    "express": "^4.18.0",    // ✅ Pinned major version
    "lodash": "*",            // ❌ Wildcard
    "legacy-lib": "^0.5.0"   // ⚠️ Unstable 0.x
  }
}
```

### Magic Numbers

**Definition**: Numeric literals without clear meaning

**Anti-patterns**:
```javascript
// ❌ Magic numbers
if (user.age > 18) { }
setTimeout(() => {}, 5000);
buffer = new Array(1048576);

// ✅ Named constants
const LEGAL_AGE = 18;
const RETRY_DELAY_MS = 5000;
const BUFFER_SIZE_1MB = 1024 * 1024;

if (user.age > LEGAL_AGE) { }
setTimeout(() => {}, RETRY_DELAY_MS);
buffer = new Array(BUFFER_SIZE_1MB);
```

**Exceptions** (acceptable magic numbers):
- 0, 1, -1 (common values)
- 100, 1000 (obvious scaling factors in context)
- HTTP status codes (200, 404, 500)

## Error Handling Standards

### Required Error Handling

**Categories**:
- Network errors (timeout, connection failure)
- Database errors (query failure, constraint violation)
- Validation errors (invalid input)
- Authentication/Authorization errors

**Anti-patterns**:
```javascript
// ❌ Silent failure
try {
  await saveUser(user);
} catch (err) {
  // Empty catch
}

// ❌ Generic catch
try {
  await processPayment(order);
} catch (err) {
  console.log('Error');  // No details
}

// ✅ Proper handling
try {
  await processPayment(order);
} catch (err) {
  logger.error('Payment processing failed', { orderId: order.id, error: err });
  throw new PaymentError('Failed to process payment', { cause: err });
}
```

### Logging Standards

**Required Logs**:
- Authentication attempts (success/failure)
- Authorization failures
- Data modifications (create/update/delete)
- External API calls
- Errors and exceptions

**Log Levels**:
- **ERROR**: System errors, exceptions
- **WARN**: Recoverable issues, deprecations
- **INFO**: Business events, state changes
- **DEBUG**: Detailed troubleshooting info

**Sensitive Data**:
- Never log: passwords, tokens, credit cards, SSNs
- Hash/mask: emails, IPs, usernames (in production)

## Code Structure Standards

### File Organization

**Max File Size**: 300 lines (excluding tests)
**Max Function Size**: 50 lines

**Module Structure**:
```
module/
  ├── index.ts          # Public exports
  ├── types.ts          # Type definitions
  ├── constants.ts      # Constants
  ├── utils.ts          # Utilities
  ├── service.ts        # Business logic
  └── service.test.ts   # Tests
```

### Import Organization

**Order**:
1. External dependencies
2. Internal modules (absolute imports)
3. Relative imports
4. Type imports (TypeScript)

```typescript
// ✅ Organized imports
import express from 'express';
import { Logger } from 'winston';

import { UserService } from '@/services/user';
import { config } from '@/config';

import { validateEmail } from './utils';
import { UserRepository } from './repository';

import type { User, UserCreateInput } from './types';
```

## Scoring System

### Overall Score Calculation

```
Overall Score = (
  Security Score × 0.4 +
  Code Quality Score × 0.25 +
  Performance Score × 0.2 +
  Maintainability Score × 0.15
)

Security = 100 - (Critical × 30 + High × 2 + Medium × 0.5)
Code Quality = 100 - (violations / total_checks × 100)
Performance = 100 - (issues / potential_issues × 100)
Maintainability = (doc_coverage × 0.4 + test_coverage × 0.4 + dependency_health × 0.2)
```

### Risk Levels

- **LOW**: Score 90-100
- **MEDIUM**: Score 70-89
- **HIGH**: Score 50-69
- **CRITICAL**: Score < 50
