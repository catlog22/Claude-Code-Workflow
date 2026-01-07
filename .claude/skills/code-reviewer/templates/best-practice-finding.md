# Best Practice Finding Template

Use this template for documenting code quality, performance, and maintainability issues.

## Finding Structure

```json
{
  "id": "BP-{number}",
  "type": "{issue-type}",
  "category": "{code_quality|performance|maintainability}",
  "severity": "{high|medium|low}",
  "file": "{file-path}",
  "line": {line-number},
  "function": "{function-name}",
  "message": "{clear-description}",
  "recommendation": {
    "description": "{how-to-fix}",
    "example": "{corrected-code}"
  }
}
```

## Markdown Template

```markdown
### 🟠 [BP-{number}] {Issue Title}

**File**: `{file-path}:{line}`
**Category**: {Code Quality|Performance|Maintainability}

**Issue**: {Detailed explanation of the problem}

**Current Code**:
\`\`\`{language}
{problematic-code}
\`\`\`

**Recommended Fix**:
\`\`\`{language}
{improved-code-with-comments}
\`\`\`

**Impact**: {Why this matters - readability, performance, maintainability}

---
```

## Example: High Complexity

```markdown
### 🟠 [BP-001] High Cyclomatic Complexity

**File**: `src/utils/validator.ts:78`
**Category**: Code Quality
**Function**: `validateUserInput`
**Complexity**: 15 (threshold: 10)

**Issue**: Function has 15 decision points, making it difficult to test and maintain.

**Current Code**:
\`\`\`typescript
function validateUserInput(input) {
  if (!input) return false;
  if (!input.email) return false;
  if (!input.email.includes('@')) return false;
  if (input.email.length > 255) return false;
  // ... 11 more conditions
}
\`\`\`

**Recommended Fix**:
\`\`\`typescript
// Extract validation rules
const validationRules = {
  email: (email) => email && email.includes('@') && email.length <= 255,
  password: (pwd) => pwd && pwd.length >= 8 && /[A-Z]/.test(pwd),
  username: (name) => name && /^[a-zA-Z0-9_]+$/.test(name),
};

// Simplified validator
function validateUserInput(input) {
  return Object.entries(validationRules).every(([field, validate]) =>
    validate(input[field])
  );
}
\`\`\`

**Impact**: Reduces complexity from 15 to 3, improves testability, and makes validation rules reusable.

---
```

## Example: N+1 Query

```markdown
### 🟠 [BP-002] N+1 Query Pattern

**File**: `src/api/orders.ts:45`
**Category**: Performance

**Issue**: Database query executed inside loop, causing N+1 queries problem. For 100 orders, this creates 101 database queries instead of 2.

**Current Code**:
\`\`\`typescript
const orders = await Order.findAll();
for (const order of orders) {
  const user = await User.findById(order.userId);
  order.userName = user.name;
}
\`\`\`

**Recommended Fix**:
\`\`\`typescript
// Batch query all users at once
const orders = await Order.findAll();
const userIds = orders.map(o => o.userId);
const users = await User.findByIds(userIds);

// Create lookup map for O(1) access
const userMap = new Map(users.map(u => [u.id, u]));

// Enrich orders with user data
for (const order of orders) {
  order.userName = userMap.get(order.userId)?.name;
}
\`\`\`

**Impact**: Reduces database queries from O(n) to O(1), significantly improving performance for large datasets.

---
```

## Example: Missing Documentation

```markdown
### 🟡 [BP-003] Missing Documentation

**File**: `src/services/PaymentService.ts:23`
**Category**: Maintainability

**Issue**: Exported class lacks documentation, making it difficult for other developers to understand its purpose and usage.

**Current Code**:
\`\`\`typescript
export class PaymentService {
  async processPayment(orderId: string, amount: number) {
    // implementation
  }
}
\`\`\`

**Recommended Fix**:
\`\`\`typescript
/**
 * Service for processing payment transactions
 * 
 * Handles payment processing, refunds, and transaction logging.
 * Integrates with Stripe payment gateway.
 * 
 * @example
 * const paymentService = new PaymentService();
 * const result = await paymentService.processPayment('order-123', 99.99);
 */
export class PaymentService {
  /**
   * Process a payment for an order
   * 
   * @param orderId - Unique order identifier
   * @param amount - Payment amount in USD
   * @returns Payment confirmation with transaction ID
   * @throws {PaymentError} If payment processing fails
   */
  async processPayment(orderId: string, amount: number) {
    // implementation
  }
}
\`\`\`

**Impact**: Improves code discoverability and reduces onboarding time for new developers.

---
```

## Example: Memory Leak

```markdown
### 🟠 [BP-004] Potential Memory Leak

**File**: `src/components/Chat.tsx:56`
**Category**: Performance

**Issue**: WebSocket event listener added without cleanup, causing memory leaks when component unmounts.

**Current Code**:
\`\`\`tsx
useEffect(() => {
  socket.on('message', handleMessage);
}, []);
\`\`\`

**Recommended Fix**:
\`\`\`tsx
useEffect(() => {
  socket.on('message', handleMessage);
  
  // Cleanup on unmount
  return () => {
    socket.off('message', handleMessage);
  };
}, []);
\`\`\`

**Impact**: Prevents memory leaks and improves application stability in long-running sessions.

---
```

## Severity Guidelines

### High
- Major performance impact (N+1 queries, O(n²) algorithms)
- Critical maintainability issues (complexity > 15)
- Missing error handling in critical paths

### Medium
- Moderate performance impact
- Code quality issues (complexity 11-15, duplication)
- Missing tests for important features

### Low
- Minor style violations
- Missing documentation
- Low-impact dead code
