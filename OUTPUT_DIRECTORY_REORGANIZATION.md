# Output Directory Reorganization Recommendations

## Executive Summary

Current output directory structure mixes different operation types (read-only analysis, code modifications, planning artifacts) in the same directories, leading to confusion and poor organization. This document proposes a **semantic directory structure** that separates outputs by purpose and operation type.

**Impact**: Affects 30+ commands, requires phased migration
**Priority**: MEDIUM (improves clarity, not critical functionality)
**Effort**: 2-4 weeks for full implementation

---

## Current Structure Analysis

### Active Session Structure

```
.workflow/active/WFS-{session-id}/
├── workflow-session.json          # Session metadata
├── IMPL_PLAN.md                   # Planning document
├── TODO_LIST.md                   # Progress tracking
│
├── .chat/                         # ⚠️ MIXED PURPOSE
│   ├── analyze-*.md               # Read-only analysis
│   ├── plan-*.md                  # Read-only planning
│   ├── discuss-plan-*.md          # Read-only discussion
│   ├── execute-*.md               # ⚠️ Code-modifying execution
│   └── chat-*.md                  # Q&A interactions
│
├── .summaries/                    # Task completion summaries
│   ├── IMPL-*-summary.md
│   └── TEST-FIX-*-summary.md
│
├── .task/                         # Task definitions
│   ├── IMPL-001.json
│   └── IMPL-001.1.json
│
└── .process/                      # ⚠️ MIXED PURPOSE
    ├── context-package.json       # Planning context
    ├── test-context-package.json  # Test context
    ├── phase2-analysis.json       # Temporary analysis
    ├── CONFLICT_RESOLUTION.md     # Planning artifact
    ├── ACTION_PLAN_VERIFICATION.md # Verification report
    └── backup/                    # Backup storage
        └── replan-{timestamp}/
```

### Scratchpad Structure (No Session)

```
.workflow/.scratchpad/
├── analyze-*.md
├── execute-*.md
├── chat-*.md
└── plan-*.md
```

---

## Problems Identified

### 1. **Semantic Confusion** 🚨 CRITICAL

**Problem**: `.chat/` directory contains both:
- ✅ Read-only operations (analyze, chat, plan)
- ⚠️ Code-modifying operations (execute)

**Impact**: Users assume `.chat/` is safe (read-only), but some files represent dangerous operations

**Example**:
```bash
# These both output to .chat/ but have VERY different impacts:
/cli:analyze "review auth code"        # Read-only → .chat/analyze-*.md
/cli:execute "implement auth feature"  # ⚠️ MODIFIES CODE → .chat/execute-*.md
```

### 2. **Purpose Overload**

**Problem**: `.process/` used for multiple unrelated purposes:
- Planning artifacts (context-package.json)
- Temporary analysis (phase2-analysis.json)
- Verification reports (ACTION_PLAN_VERIFICATION.md)
- Backup storage (backup/)

**Impact**: Difficult to understand what's in `.process/`

### 3. **Inconsistent Organization**

**Problem**: Different commands use different naming patterns:
- Some use timestamps: `analyze-{timestamp}.md`
- Some use topics: `plan-{topic}.md`
- Some use task IDs: `IMPL-001-summary.md`

**Impact**: Hard to find specific outputs

### 4. **No Operation Type Distinction**

**Problem**: Can't distinguish operation type from directory structure:
- Analysis outputs mixed with execution logs
- Planning discussions mixed with implementation records
- No clear audit trail

**Impact**: Poor traceability, difficult debugging

---

## Proposed New Structure

### Design Principles

1. **Semantic Organization**: Directories reflect operation type and safety level
2. **Clear Hierarchy**: Separate by purpose → type → chronology
3. **Safety Indicators**: Code-modifying operations clearly separated
4. **Consistent Naming**: Standard patterns across all commands
5. **Backward Compatible**: Old structure accessible during migration

---

## Recommended Structure v2.0

```
.workflow/active/WFS-{session-id}/
│
├── ## Core Artifacts (Root Level)
├── workflow-session.json
├── IMPL_PLAN.md
├── TODO_LIST.md
│
├── ## Task Definitions
├── tasks/                         # (renamed from .task/)
│   ├── IMPL-001.json
│   └── IMPL-001.1.json
│
├── ## 🟢 READ-ONLY Operations (Safe)
├── analysis/                      # (split from .chat/)
│   ├── code/
│   │   ├── 2024-01-15T10-30-auth-patterns.md
│   │   └── 2024-01-15T11-45-api-structure.md
│   ├── architecture/
│   │   └── 2024-01-14T09-00-caching-layer.md
│   └── bugs/
│       └── 2024-01-16T14-20-login-bug-diagnosis.md
│
├── planning/                      # (split from .chat/)
│   ├── discussions/
│   │   └── 2024-01-13T15-00-auth-strategy-3rounds.md
│   ├── architecture/
│   │   └── 2024-01-13T16-30-database-design.md
│   └── revisions/
│       └── 2024-01-17T10-00-replan-add-2fa.md
│
├── interactions/                  # (split from .chat/)
│   ├── 2024-01-15T10-00-question-about-jwt.md
│   └── 2024-01-15T14-30-how-to-test-auth.md
│
├── ## ⚠️ CODE-MODIFYING Operations (Dangerous)
├── executions/                    # (split from .chat/)
│   ├── implementations/
│   │   ├── 2024-01-15T11-00-impl-jwt-auth.md
│   │   ├── 2024-01-15T12-30-impl-user-api.md
│   │   └── metadata.json          # Execution metadata
│   ├── test-fixes/
│   │   └── 2024-01-16T09-00-fix-auth-tests.md
│   └── refactors/
│       └── 2024-01-16T15-00-refactor-middleware.md
│
├── ## Completion Records
├── summaries/                     # (kept same)
│   ├── implementations/
│   │   ├── IMPL-001-jwt-authentication.md
│   │   └── IMPL-002-user-endpoints.md
│   ├── tests/
│   │   └── TEST-FIX-001-auth-validation.md
│   └── index.json                 # Quick lookup
│
├── ## Planning Context & Artifacts
├── context/                       # (split from .process/)
│   ├── project/
│   │   ├── context-package.json
│   │   └── test-context-package.json
│   ├── brainstorm/
│   │   ├── guidance-specification.md
│   │   ├── synthesis-output.md
│   │   └── roles/
│   │       ├── api-designer-analysis.md
│   │       └── system-architect-analysis.md
│   └── conflicts/
│       └── 2024-01-14T10-00-resolution.md
│
├── ## Verification & Quality
├── quality/                       # (split from .process/)
│   ├── verifications/
│   │   └── 2024-01-15T09-00-action-plan-verify.md
│   ├── reviews/
│   │   ├── 2024-01-17T11-00-security-review.md
│   │   └── 2024-01-17T12-00-architecture-review.md
│   └── tdd-compliance/
│       └── 2024-01-16T16-00-cycle-analysis.md
│
├── ## History & Backups
├── history/                       # (renamed from .process/backup/)
│   ├── replans/
│   │   └── 2024-01-17T10-00-add-2fa/
│   │       ├── MANIFEST.md
│   │       ├── IMPL_PLAN.md
│   │       └── tasks/
│   └── snapshots/
│       └── 2024-01-15T00-00-milestone-1/
│
└── ## Temporary Working Data
    └── temp/                      # (for transient analysis)
        └── phase2-analysis.json
```

### Scratchpad Structure v2.0

```
.workflow/.scratchpad/
├── analysis/
├── planning/
├── interactions/
└── executions/          # ⚠️ Code-modifying
```

---

## Directory Purpose Reference

| Directory | Purpose | Safety | Retention |
|-----------|---------|--------|-----------|
| `analysis/` | Code understanding, bug diagnosis | 🟢 Read-only | Keep indefinitely |
| `planning/` | Architecture plans, discussions | 🟢 Read-only | Keep indefinitely |
| `interactions/` | Q&A, chat sessions | 🟢 Read-only | Keep 30 days |
| `executions/` | Implementation logs | ⚠️ Modifies code | Keep indefinitely |
| `summaries/` | Task completion records | 🟢 Reference | Keep indefinitely |
| `context/` | Planning context, brainstorm | 🟢 Reference | Keep indefinitely |
| `quality/` | Reviews, verifications | 🟢 Reference | Keep indefinitely |
| `history/` | Backups, snapshots | 🟢 Archive | Keep indefinitely |
| `temp/` | Transient analysis data | 🟢 Temporary | Clean on completion |

---

## Naming Convention Standards

### Timestamp-based Files

**Format**: `YYYY-MM-DDTHH-MM-{description}.md`

**Examples**:
- `2024-01-15T10-30-auth-patterns.md`
- `2024-01-15T11-45-jwt-implementation.md`

**Benefits**:
- Chronological sorting
- Unique identifiers
- Easy to find by date

### Task-based Files

**Format**: `{TASK-ID}-{description}.md`

**Examples**:
- `IMPL-001-jwt-authentication.md`
- `TEST-FIX-002-login-validation.md`

**Benefits**:
- Clear task association
- Easy to find by task ID

### Metadata Files

**Format**: `{type}.json` or `{type}-metadata.json`

**Examples**:
- `context-package.json`
- `execution-metadata.json`
- `index.json`

---

## Command Output Mapping

### Analysis Commands → `analysis/`

| Command | Old Location | New Location |
|---------|-------------|--------------|
| `/cli:analyze` | `.chat/analyze-*.md` | `analysis/code/{timestamp}-{topic}.md` |
| `/cli:mode:code-analysis` | `.chat/code-analysis-*.md` | `analysis/code/{timestamp}-{topic}.md` |
| `/cli:mode:bug-diagnosis` | `.chat/bug-diagnosis-*.md` | `analysis/bugs/{timestamp}-{topic}.md` |

### Planning Commands → `planning/`

| Command | Old Location | New Location |
|---------|-------------|--------------|
| `/cli:mode:plan` | `.chat/plan-*.md` | `planning/architecture/{timestamp}-{topic}.md` |
| `/cli:discuss-plan` | `.chat/discuss-plan-*.md` | `planning/discussions/{timestamp}-{topic}.md` |
| `/workflow:replan` | (modifies artifacts) | `planning/revisions/{timestamp}-{reason}.md` |

### Execution Commands → `executions/`

| Command | Old Location | New Location |
|---------|-------------|--------------|
| `/cli:execute` | `.chat/execute-*.md` | `executions/implementations/{timestamp}-{description}.md` |
| `/cli:codex-execute` | `.chat/codex-*.md` | `executions/implementations/{timestamp}-{description}.md` |
| `/workflow:execute` | (multiple) | `executions/implementations/{timestamp}-{task-id}.md` |
| `/workflow:test-cycle-execute` | (various) | `executions/test-fixes/{timestamp}-cycle-{n}.md` |

### Quality Commands → `quality/`

| Command | Old Location | New Location |
|---------|-------------|--------------|
| `/workflow:action-plan-verify` | `.process/ACTION_PLAN_VERIFICATION.md` | `quality/verifications/{timestamp}-action-plan.md` |
| `/workflow:review` | (inline) | `quality/reviews/{timestamp}-{type}.md` |
| `/workflow:tdd-verify` | (inline) | `quality/tdd-compliance/{timestamp}-verify.md` |

### Context Commands → `context/`

| Data Type | Old Location | New Location |
|-----------|-------------|--------------|
| Context packages | `.process/context-package.json` | `context/project/context-package.json` |
| Brainstorm artifacts | `.process/` | `context/brainstorm/` |
| Conflict resolution | `.process/CONFLICT_RESOLUTION.md` | `context/conflicts/{timestamp}-resolution.md` |

---

## Migration Strategy

### Phase 1: Dual Write (Week 1-2)

**Goal**: Write to both old and new locations

**Implementation**:
```bash
# Example for /cli:analyze
old_path=".workflow/active/$session/.chat/analyze-$timestamp.md"
new_path=".workflow/active/$session/analysis/code/$timestamp-$topic.md"

# Write to both locations
Write($old_path, content)
Write($new_path, content)

# Add migration notice to old location
echo "⚠️ This file has moved to: $new_path" >> $old_path
```

**Changes**:
- Update all commands to write to new structure
- Keep writing to old structure for compatibility
- Add deprecation notices

**Commands to Update**: 30+ commands

### Phase 2: Dual Read (Week 3)

**Goal**: Read from new location, fallback to old

**Implementation**:
```bash
# Example read logic
if [ -f "$new_path" ]; then
  content=$(cat "$new_path")
elif [ -f "$old_path" ]; then
  content=$(cat "$old_path")
  # Migrate on read
  mkdir -p "$(dirname "$new_path")"
  cp "$old_path" "$new_path"
  echo "✓ Migrated: $old_path → $new_path"
fi
```

**Changes**:
- Update read logic in all commands
- Automatic migration on read
- Log migrations for verification

### Phase 3: Legacy Deprecation (Week 4)

**Goal**: Stop writing to old locations

**Implementation**:
```bash
# Stop dual write, only write to new structure
new_path=".workflow/active/$session/analysis/code/$timestamp-$topic.md"
Write($new_path, content)

# No longer write to old_path
```

**Changes**:
- Remove old write logic
- Keep read fallback for 1 release cycle
- Update documentation

### Phase 4: Full Migration (Future Release)

**Goal**: Remove old structure entirely

**Implementation**:
```bash
# One-time migration script
/workflow:migrate-outputs --session all --dry-run
/workflow:migrate-outputs --session all --execute
```

**Migration Script**:
```bash
#!/bin/bash
# migrate-outputs.sh

session_dir="$1"

# Migrate .chat/ files
for file in "$session_dir/.chat"/*; do
  case "$file" in
    *analyze*)
      mv "$file" "$session_dir/analysis/code/"
      ;;
    *execute*)
      mv "$file" "$session_dir/executions/implementations/"
      ;;
    *plan*)
      mv "$file" "$session_dir/planning/architecture/"
      ;;
    *chat*)
      mv "$file" "$session_dir/interactions/"
      ;;
  esac
done

# Migrate .process/ files
mv "$session_dir/.process/context-package.json" "$session_dir/context/project/"
mv "$session_dir/.process/backup" "$session_dir/history/"

# Remove old directories
rmdir "$session_dir/.chat" "$session_dir/.process" 2>/dev/null

echo "✓ Migration complete: $session_dir"
```

---

## Implementation Checklist

### Week 1-2: Dual Write Setup

**Core Commands** (Priority 1):
- [ ] `/cli:analyze` → `analysis/code/`
- [ ] `/cli:execute` → `executions/implementations/`
- [ ] `/cli:mode:plan` → `planning/architecture/`
- [ ] `/workflow:execute` → `executions/implementations/`
- [ ] `/workflow:action-plan-verify` → `quality/verifications/`

**Planning Commands** (Priority 2):
- [ ] `/cli:discuss-plan` → `planning/discussions/`
- [ ] `/workflow:replan` → `planning/revisions/`
- [ ] `/workflow:plan` → (updates `context/project/`)

**Context Commands** (Priority 3):
- [ ] `/workflow:tools:context-gather` → `context/project/`
- [ ] `/workflow:brainstorm:*` → `context/brainstorm/`
- [ ] `/workflow:tools:conflict-resolution` → `context/conflicts/`

### Week 3: Dual Read + Auto-Migration

**Read Logic Updates**:
- [ ] Update all Read() calls with fallback logic
- [ ] Add migration-on-read for all file types
- [ ] Log all automatic migrations

**Testing**:
- [ ] Test with existing sessions
- [ ] Test with new sessions
- [ ] Verify backward compatibility

### Week 4: Documentation + Deprecation

**Documentation Updates**:
- [ ] Update command documentation with new paths
- [ ] Add migration guide for users
- [ ] Document new directory structure
- [ ] Add "Directory Purpose Reference" to docs

**Deprecation Notices**:
- [ ] Add notices to old command outputs
- [ ] Update error messages with new paths
- [ ] Create migration FAQ

---

## Benefits Analysis

### Immediate Benefits

**1. Safety Clarity** 🟢
- Clear separation: Read-only vs Code-modifying operations
- Users can quickly identify dangerous operations
- Reduces accidental code modifications

**2. Better Organization** 📁
- Semantic structure reflects operation purpose
- Easy to find specific outputs
- Clear audit trail

**3. Improved Traceability** 🔍
- Execution logs separated by type
- Planning discussions organized chronologically
- Quality checks easily accessible

### Long-term Benefits

**4. Scalability** 📈
- Structure scales to 100+ sessions
- Easy to add new operation types
- Consistent organization patterns

**5. Automation Potential** 🤖
- Programmatic analysis of outputs
- Automated cleanup of old files
- Better CI/CD integration

**6. User Experience** 👥
- Intuitive directory structure
- Self-documenting organization
- Easier onboarding for new users

---

## Risk Assessment

### Migration Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking Changes** | HIGH | Phased migration with dual write/read |
| **Data Loss** | MEDIUM | Automatic migration on read, keep backups |
| **User Confusion** | MEDIUM | Clear documentation, migration guide |
| **Command Failures** | LOW | Fallback to old locations during transition |
| **Performance Impact** | LOW | Dual write adds minimal overhead |

### Rollback Strategy

If migration causes issues:

**Phase 1 Rollback** (Dual Write):
- Stop writing to new locations
- Continue using old structure
- No data loss

**Phase 2 Rollback** (Dual Read):
- Disable migration-on-read
- Continue reading from old locations
- New files still in new structure (OK)

**Phase 3+ Rollback**:
- Run reverse migration script
- Copy new structure files back to old locations
- May require manual intervention

---

## Alternative Approaches Considered

### Alternative 1: Flat Structure with Prefixes

```
.workflow/active/WFS-{session}/
├── ANALYSIS_2024-01-15_auth-patterns.md
├── EXEC_2024-01-15_jwt-impl.md
└── PLAN_2024-01-14_architecture.md
```

**Rejected**: Too many files in one directory, poor organization

### Alternative 2: Single "logs/" Directory

```
.workflow/active/WFS-{session}/
└── logs/
    ├── 2024-01-15T10-30-analyze-auth.md
    └── 2024-01-15T11-00-execute-jwt.md
```

**Rejected**: Doesn't solve semantic confusion

### Alternative 3: Minimal Change (Status Quo++)

```
.workflow/active/WFS-{session}/
├── .chat/          # Rename to .interactions/
├── .exec/          # NEW: Split executions out
├── .summaries/
└── .process/
```

**Partially Adopted**: Considered as "lite" version if full migration too complex

---

## Recommended Timeline

### Immediate (This Sprint)
1. ✅ Document current structure
2. ✅ Create proposed structure v2.0
3. ✅ Get stakeholder approval

### Short-term (Next 2 Sprints - 4 weeks)
1. 📝 Implement Phase 1: Dual Write
2. 🔍 Implement Phase 2: Dual Read
3. 📢 Implement Phase 3: Deprecation

### Long-term (Future Release)
1. 🗑️ Implement Phase 4: Full Migration
2. 🧹 Remove old structure code
3. 📚 Update all documentation

---

## Success Metrics

### Quantitative
- ✅ 100% of commands updated to new structure
- ✅ 0 data loss during migration
- ✅ <5% increase in execution time (dual write overhead)
- ✅ 90% of sessions migrated within 1 month

### Qualitative
- ✅ User feedback: "Easier to find outputs"
- ✅ User feedback: "Clearer which operations are safe"
- ✅ Developer feedback: "Easier to maintain"

---

## Conclusion

The proposed directory reorganization addresses critical semantic confusion in the current structure by:

1. **Separating read-only from code-modifying operations** (safety)
2. **Organizing by purpose** (usability)
3. **Using consistent naming** (maintainability)
4. **Providing clear migration path** (feasibility)

**Recommendation**: Proceed with phased migration starting with dual-write implementation.

**Next Steps**:
1. Review and approve proposed structure
2. Identify pilot commands for Phase 1
3. Create detailed implementation tasks
4. Begin dual-write implementation

**Questions for Discussion**:
1. Should we use "lite" version (minimal changes) or full v2.0?
2. What's the acceptable timeline for full migration?
3. Are there any other directory purposes we should consider?
4. Should we add more automation (e.g., auto-cleanup old files)?
