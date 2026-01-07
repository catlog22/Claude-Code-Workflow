# TypeScript Naming Conventions

This rule enforces consistent naming conventions for TypeScript code to improve readability and maintain codebase consistency.

## Guidelines

1. **Variables and Functions** - Use camelCase for all variable names, function names, and function parameters
2. **Classes and Interfaces** - Use PascalCase for class names, interface names, type aliases, and enum names
3. **Constants** - Use UPPER_SNAKE_CASE for module-level constants and readonly static class members
4. **Private Members** - Use camelCase with no special prefix for private class members (rely on TypeScript's `private` keyword)
5. **File Names** - Use kebab-case for file names (e.g., `user-service.ts`, `auth-controller.ts`)

## Examples

### ✅ Correct

```typescript
// Variables and functions
const userName = 'John';
let itemCount = 0;
function calculateTotal(orderItems: Item[]): number {
  return orderItems.reduce((sum, item) => sum + item.price, 0);
}

// Classes and interfaces
class UserService {
  private userRepository: UserRepository;
  
  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }
}

interface ApiResponse {
  statusCode: number;
  data: unknown;
}

type UserId = string;

enum OrderStatus {
  Pending,
  Confirmed,
  Shipped
}

// Constants
const MAX_RETRY_ATTEMPTS = 3;
const API_BASE_URL = 'https://api.example.com';

class Configuration {
  static readonly DEFAULT_TIMEOUT = 5000;
}
```

### ❌ Incorrect

```typescript
// Wrong: PascalCase for variables/functions
const UserName = 'John';
function CalculateTotal(order_items: Item[]): number { }

// Wrong: camelCase for classes/interfaces
class userService { }
interface apiResponse { }
type userId = string;

// Wrong: camelCase for constants
const maxRetryAttempts = 3;
const apiBaseUrl = 'https://api.example.com';

// Wrong: snake_case usage
const user_name = 'John';
function calculate_total(items: Item[]): number { }
class user_service { }

// Wrong: Hungarian notation or underscore prefix for private
class Service {
  private _userData: User;  // Don't use underscore prefix
  private m_count: number;  // Don't use Hungarian notation
}
```

## Exceptions

- Third-party library types and names should maintain their original casing for compatibility
- Database column names or API field names may use different conventions when mapped from external systems (use transformation layers to convert)
- Test files may use descriptive names like `UserService.test.ts` to match the tested class