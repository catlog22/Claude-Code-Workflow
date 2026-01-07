# Phase 1: Code Discovery & Scoping

## Objective

Discover and categorize all code files within the specified scope, preparing them for security analysis and best practices review.

## Input

- **User Arguments**:
  - `--scope`: Directory or file patterns (default: entire project)
  - `--languages`: Specific languages to review (e.g., typescript, python, java)
  - `--exclude`: Patterns to exclude (e.g., test files, node_modules)

- **Configuration**: `.code-reviewer.json` (if exists)

## Process

### Step 1: Load Configuration

```javascript
// Check for project-level configuration
const configPath = path.join(projectRoot, '.code-reviewer.json');
const config = fileExists(configPath)
  ? JSON.parse(readFile(configPath))
  : getDefaultConfig();

// Merge user arguments with config
const scope = args.scope || config.scope.include;
const exclude = args.exclude || config.scope.exclude;
const languages = args.languages || config.languages || 'auto';
```

### Step 2: Discover Files

Use MCP tools for efficient file discovery:

```javascript
// Use smart_search for file discovery
const files = await mcp__ccw_tools__smart_search({
  action: "find_files",
  pattern: scope,
  includeHidden: false
});

// Apply exclusion patterns
const filteredFiles = files.filter(file => {
  return !exclude.some(pattern => minimatch(file, pattern));
});
```

### Step 3: Categorize Files

Categorize files by:
- **Language/Framework**: TypeScript, Python, Java, Go, etc.
- **File Type**: Source, config, test, build
- **Priority**: Critical (auth, payment), High (API), Medium (utils), Low (docs)

```javascript
const inventory = {
  critical: {
    auth: ['src/auth/login.ts', 'src/auth/jwt.ts'],
    payment: ['src/payment/stripe.ts'],
  },
  high: {
    api: ['src/api/users.ts', 'src/api/orders.ts'],
    database: ['src/db/queries.ts'],
  },
  medium: {
    utils: ['src/utils/validator.ts'],
    services: ['src/services/*.ts'],
  },
  low: {
    types: ['src/types/*.ts'],
  }
};
```

### Step 4: Extract Metadata

For each file, extract:
- **Lines of Code (LOC)**
- **Complexity Indicators**: Function count, class count
- **Dependencies**: Import statements
- **Framework Detection**: Express, React, Django, etc.

```javascript
const metadata = files.map(file => ({
  path: file,
  language: detectLanguage(file),
  loc: countLines(file),
  complexity: estimateComplexity(file),
  framework: detectFramework(file),
  priority: categorizePriority(file)
}));
```

## Output

### File Inventory

Save to `.code-review/inventory.json`:

```json
{
  "scan_date": "2024-01-15T10:30:00Z",
  "total_files": 247,
  "by_language": {
    "typescript": 185,
    "python": 42,
    "javascript": 15,
    "go": 5
  },
  "by_priority": {
    "critical": 12,
    "high": 45,
    "medium": 120,
    "low": 70
  },
  "files": [
    {
      "path": "src/auth/login.ts",
      "language": "typescript",
      "loc": 245,
      "functions": 8,
      "classes": 2,
      "priority": "critical",
      "framework": "express",
      "dependencies": ["bcrypt", "jsonwebtoken", "express"]
    }
  ]
}
```

### Summary Report

```markdown
## Code Discovery Summary

**Scope**: src/**/*
**Total Files**: 247
**Languages**: TypeScript (75%), Python (17%), JavaScript (6%), Go (2%)

### Priority Distribution
- Critical: 12 files (authentication, payment processing)
- High: 45 files (API endpoints, database queries)
- Medium: 120 files (utilities, services)
- Low: 70 files (types, configs)

### Key Areas Identified
1. **Authentication Module** (src/auth/) - 12 files, 2,400 LOC
2. **Payment Processing** (src/payment/) - 5 files, 1,200 LOC
3. **API Layer** (src/api/) - 35 files, 5,600 LOC
4. **Database Layer** (src/db/) - 8 files, 1,800 LOC

**Next Phase**: Security Analysis on Critical + High priority files
```

## State Management

Save phase state for potential resume:

```json
{
  "phase": "01-code-discovery",
  "status": "completed",
  "timestamp": "2024-01-15T10:35:00Z",
  "output": {
    "inventory_path": ".code-review/inventory.json",
    "total_files": 247,
    "critical_files": 12,
    "high_files": 45
  }
}
```

## Agent Instructions

```markdown
You are in Phase 1 of the Code Review workflow. Your task is to discover and categorize code files.

**Instructions**:
1. Use mcp__ccw_tools__smart_search with action="find_files" to discover files
2. Apply exclusion patterns from config or arguments
3. Categorize files by language, type, and priority
4. Extract basic metadata (LOC, complexity indicators)
5. Save inventory to .code-review/inventory.json
6. Generate summary report
7. Proceed to Phase 2 with critical + high priority files

**Tools Available**:
- mcp__ccw_tools__smart_search (file discovery)
- Read (read configuration and sample files)
- Write (save inventory and reports)

**Output Requirements**:
- inventory.json with complete file list and metadata
- Summary markdown report
- State file for phase tracking
```

## Error Handling

### No Files Found

```javascript
if (filteredFiles.length === 0) {
  throw new Error(`No files found matching scope: ${scope}

  Suggestions:
  - Check if scope pattern is correct
  - Verify exclude patterns are not too broad
  - Ensure project has code files in specified scope
  `);
}
```

### Large Codebase

```javascript
if (filteredFiles.length > 1000) {
  console.warn(`⚠️ Large codebase detected (${filteredFiles.length} files)`);
  console.log(`Consider using --scope to review in batches`);

  // Offer to focus on critical/high priority only
  const answer = await askUser("Review critical/high priority files only?");
  if (answer === 'yes') {
    filteredFiles = filteredFiles.filter(f =>
      f.priority === 'critical' || f.priority === 'high'
    );
  }
}
```

## Validation

Before proceeding to Phase 2:

- ✅ Inventory file created
- ✅ At least one file categorized as critical or high priority
- ✅ Metadata extracted for all files
- ✅ Summary report generated
- ✅ State saved for resume capability

## Next Phase

**Phase 2: Security Analysis** - Analyze critical and high priority files for security vulnerabilities using OWASP Top 10 and CWE Top 25 checks.
