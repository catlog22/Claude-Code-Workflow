# Command Ambiguity Analysis

## Executive Summary

Analysis of 74 commands reveals **5 major ambiguity clusters** that could cause user confusion. The primary issues involve overlapping functionality in planning, execution, and analysis commands, with inconsistent parameter usage and unclear decision criteria.

---

## Critical Ambiguities (HIGH Priority)

### 1. Planning Command Overload ⚠️ CRITICAL

**Problem**: 5 different "plan" commands with overlapping but distinct purposes

| Command | Purpose | Outputs | Mode |
|---------|---------|---------|------|
| `/workflow:plan` | 5-phase planning workflow | IMPL_PLAN.md + task JSONs | Autonomous |
| `/workflow:lite-plan` | Lightweight interactive planning | In-memory plan | Interactive |
| `/workflow:replan` | Modify existing plans | Updates existing artifacts | Interactive |
| `/cli:mode:plan` | Architecture planning | .chat/plan-*.md | Read-only |
| `/cli:discuss-plan` | Multi-round collaborative planning | .chat/discuss-plan-*.md | Multi-model discussion |

**Ambiguities**:
- ❌ **Intent confusion**: Users don't know which to use for "planning"
- ❌ **Output confusion**: Some create tasks, some don't
- ❌ **Workflow confusion**: Different levels of automation
- ❌ **Scope confusion**: Project-level vs architecture-level vs modification planning

**User Questions**:
- "I want to plan my project - which command do I use?"
- "What's the difference between `/workflow:plan` and `/workflow:lite-plan`?"
- "When should I use `/cli:mode:plan` vs `/workflow:plan`?"

**Recommendations**:
1. ✅ Create decision tree documentation
2. ✅ Rename commands to clarify scope:
   - `/workflow:plan` → `/workflow:project-plan` (full workflow)
   - `/workflow:lite-plan` → `/workflow:quick-plan` (fast planning)
   - `/cli:mode:plan` → `/cli:architecture-plan` (read-only)
3. ✅ Add command hints in descriptions about when to use each

---

### 2. Execution Command Confusion ⚠️ CRITICAL

**Problem**: 5 different "execute" commands with different behaviors

| Command | Input | Modifies Code | Auto-Approval | Context |
|---------|-------|---------------|---------------|---------|
| `/workflow:execute` | Session | Via agents | No | Full workflow |
| `/workflow:lite-execute` | Plan/prompt/file | Via agent/codex | User choice | Lightweight |
| `/cli:execute` | Description/task-id | YES | YOLO | Direct implementation |
| `/cli:codex-execute` | Description | YES | YOLO | Multi-stage Codex |
| `/task:execute` | task-id | Via agent | No | Single task |

**Ambiguities**:
- ❌ **Safety confusion**: Some have YOLO auto-approval, others don't
- ❌ **Input confusion**: Different input formats
- ❌ **Scope confusion**: Workflow vs task vs direct execution
- ❌ **Tool confusion**: Agent vs CLI tool execution

**Critical Risk**:
- Users may accidentally use `/cli:execute` (YOLO) when they meant `/workflow:execute` (controlled)
- This could result in unwanted code modifications

**User Questions**:
- "I have a workflow session - do I use `/workflow:execute` or `/task:execute`?"
- "What's the difference between `/cli:execute` and `/workflow:lite-execute`?"
- "Which execute command is safest for production code?"

**Recommendations**:
1. 🚨 Add safety warnings to YOLO commands
2. ✅ Clear documentation on execution modes:
   - **Workflow execution**: `/workflow:execute` (controlled, session-based)
   - **Quick execution**: `/workflow:lite-execute` (flexible input)
   - **Direct implementation**: `/cli:execute` (⚠️ YOLO auto-approval)
3. ✅ Consider renaming:
   - `/cli:execute` → `/cli:implement-auto` (emphasizes auto-approval)
   - `/cli:codex-execute` → `/cli:codex-multi-stage`

---

### 3. Analysis Command Overlap ⚠️ MEDIUM

**Problem**: Multiple analysis commands with unclear distinctions

| Command | Tool | Purpose | Output |
|---------|------|---------|--------|
| `/cli:analyze` | Gemini/Qwen/Codex | General codebase analysis | .chat/analyze-*.md |
| `/cli:mode:code-analysis` | Gemini/Qwen/Codex | Execution path tracing | .chat/code-analysis-*.md |
| `/cli:mode:bug-diagnosis` | Gemini/Qwen/Codex | Bug root cause analysis | .chat/bug-diagnosis-*.md |
| `/cli:chat` | Gemini/Qwen/Codex | Q&A interaction | .chat/chat-*.md |

**Ambiguities**:
- ❌ **Use case overlap**: When to use general analysis vs specialized modes
- ❌ **Template confusion**: Different templates but similar outputs
- ❌ **Mode naming**: "mode" prefix adds extra layer of confusion

**User Questions**:
- "Should I use `/cli:analyze` or `/cli:mode:code-analysis` to understand this code?"
- "What's special about the 'mode' commands?"

**Recommendations**:
1. ✅ Consolidate or clarify:
   - Keep `/cli:analyze` for general use
   - Document `/cli:mode:*` as specialized templates
2. ✅ Add use case examples in descriptions
3. ✅ Consider flattening:
   - `/cli:mode:code-analysis` → `/cli:trace-execution`
   - `/cli:mode:bug-diagnosis` → `/cli:diagnose-bug`

---

## Medium Priority Ambiguities

### 4. Task vs Workflow Command Overlap

**Problem**: Parallel command hierarchies

**Workflow Commands**:
- `/workflow:plan` - Create workflow with tasks
- `/workflow:execute` - Execute all tasks
- `/workflow:replan` - Modify workflow

**Task Commands**:
- `/task:create` - Create individual task
- `/task:execute` - Execute single task
- `/task:replan` - Modify task

**Ambiguities**:
- ❌ **Scope confusion**: When to use workflow vs task commands
- ❌ **Execution confusion**: `/task:execute` vs `/workflow:execute`

**Recommendations**:
1. ✅ Document relationship clearly:
   - Workflow commands: Multi-task orchestration
   - Task commands: Single-task operations
2. ✅ Add cross-references in documentation

---

### 5. Tool Selection Confusion (`--tool` flag)

**Problem**: Many commands accept `--tool codex|gemini|qwen` without clear criteria

**Commands with --tool**:
- `/cli:execute --tool`
- `/cli:analyze --tool`
- `/cli:mode:plan --tool`
- `/memory:update-full --tool`
- And more...

**Ambiguities**:
- ❌ **Selection criteria**: No clear guidance on when to use which tool
- ❌ **Default inconsistency**: Different defaults across commands
- ❌ **Capability confusion**: What each tool is best for

**Recommendations**:
1. ✅ Create tool selection guide:
   - **Gemini**: Best for analysis, planning (default for most)
   - **Qwen**: Fallback when Gemini unavailable
   - **Codex**: Best for complex implementation, multi-stage execution
2. ✅ Add tool selection hints to command descriptions
3. ✅ Document tool capabilities clearly

---

### 6. Enhancement Flag Inconsistency

**Problem**: Different enhancement flags with different meanings

| Command | Flag | Meaning |
|---------|------|---------|
| `/cli:execute` | `--enhance` | Enhance prompt via `/enhance-prompt` |
| `/cli:analyze` | `--enhance` | Enhance prompt via `/enhance-prompt` |
| `/workflow:lite-plan` | `-e` or `--explore` | Force code exploration |
| `/memory:skill-memory` | `--regenerate` | Regenerate existing files |

**Ambiguities**:
- ❌ **Flag meaning**: `-e` means different things
- ❌ **Inconsistent naming**: `--enhance` vs `--explore` vs `--regenerate`

**Recommendations**:
1. ✅ Standardize flags:
   - Use `--enhance` consistently for prompt enhancement
   - Use `--explore` specifically for codebase exploration
   - Use `--regenerate` for file regeneration
2. ✅ Avoid short flags (`-e`) that could be ambiguous

---

## Low Priority Observations

### 7. Session Management Commands (Well-Designed ✅)

**Commands**:
- `/workflow:session:start`
- `/workflow:session:resume`
- `/workflow:session:complete`
- `/workflow:session:list`

**Analysis**: These are **well-designed** with clear, distinct purposes. No ambiguity found.

---

### 8. Memory Commands (Acceptable)

Memory commands follow consistent patterns but could benefit from better organization:
- `/memory:load`
- `/memory:docs`
- `/memory:skill-memory`
- `/memory:code-map-memory`
- `/memory:update-full`
- `/memory:update-related`

**Minor Issue**: Many memory commands, but purposes are relatively clear.

---

## Parameter Ambiguity Analysis

### Common Parameter Patterns

| Parameter | Commands Using It | Ambiguity Level |
|-----------|-------------------|-----------------|
| `--tool` | 10+ commands | HIGH - Inconsistent defaults |
| `--enhance` | 5+ commands | MEDIUM - Similar but not identical |
| `--session` | 8+ commands | LOW - Consistent meaning |
| `--cli-execute` | 3+ commands | LOW - Clear meaning |
| `-e` / `--explore` | 2+ commands | HIGH - Different meanings |

---

## Output Ambiguity Analysis

### Output Location Confusion

Multiple commands output to similar locations:

**`.chat/` outputs** (read-only analysis):
- `/cli:analyze` → `.chat/analyze-*.md`
- `/cli:mode:plan` → `.chat/plan-*.md`
- `/cli:discuss-plan` → `.chat/discuss-plan-*.md`
- `/cli:execute` → `.chat/execute-*.md` (❌ Misleading - actually modifies code!)

**Ambiguity**:
- Users might think all `.chat/` outputs are read-only
- `/cli:execute` outputs to `.chat/` but modifies code (YOLO)

**Recommendation**:
- ✅ Separate execution logs from analysis logs
- ✅ Use different directory for code-modifying operations

---

## Decision Tree Recommendations

### When to Use Planning Commands

```
START: I need to plan something
│
├─ Is this a new full project workflow?
│  └─ YES → /workflow:plan (5-phase, creates tasks)
│
├─ Do I need quick planning without full workflow?
│  └─ YES → /workflow:lite-plan (fast, interactive)
│
├─ Do I need architecture-level planning only?
│  └─ YES → /cli:mode:plan (read-only, no tasks)
│
├─ Do I need multi-perspective discussion?
│  └─ YES → /cli:discuss-plan (Gemini + Codex + Claude)
│
└─ Am I modifying an existing plan?
   └─ YES → /workflow:replan (modify artifacts)
```

### When to Use Execution Commands

```
START: I need to execute/implement something
│
├─ Do I have an active workflow session with tasks?
│  └─ YES → /workflow:execute (execute all tasks)
│
├─ Do I have a single task ID to execute?
│  └─ YES → /task:execute IMPL-N (single task)
│
├─ Do I have a plan or description to execute quickly?
│  └─ YES → /workflow:lite-execute (flexible input)
│
├─ Do I want direct, autonomous implementation (⚠️ YOLO)?
│  ├─ Single-stage → /cli:execute (auto-approval)
│  └─ Multi-stage → /cli:codex-execute (complex tasks)
│
└─ ⚠️ WARNING: CLI execute commands modify code without confirmation
```

### When to Use Analysis Commands

```
START: I need to analyze code
│
├─ General codebase understanding?
│  └─ /cli:analyze (broad analysis)
│
├─ Specific execution path tracing?
│  └─ /cli:mode:code-analysis (detailed flow)
│
├─ Bug diagnosis?
│  └─ /cli:mode:bug-diagnosis (root cause)
│
└─ Quick Q&A?
   └─ /cli:chat (interactive)
```

---

## Summary of Findings

### Ambiguity Count by Severity

| Severity | Count | Commands Affected |
|----------|-------|-------------------|
| 🚨 CRITICAL | 2 | Planning (5 cmds), Execution (5 cmds) |
| ⚠️ HIGH | 2 | Tool selection, Enhancement flags |
| ℹ️ MEDIUM | 3 | Analysis, Task/Workflow overlap, Output locations |
| ✅ LOW | Multiple | Most other commands acceptable |

### Key Recommendations Priority

1. **🚨 URGENT**: Add safety warnings to YOLO execution commands
2. **🚨 URGENT**: Create decision trees for planning and execution commands
3. **⚠️ HIGH**: Standardize tool selection criteria documentation
4. **⚠️ HIGH**: Clarify enhancement flag meanings
5. **ℹ️ MEDIUM**: Reorganize output directories by operation type
6. **ℹ️ MEDIUM**: Consider renaming most ambiguous commands

---

## Recommended Actions

### Immediate (Week 1)
1. ✅ Add decision trees to documentation
2. ✅ Add ⚠️ WARNING labels to YOLO commands
3. ✅ Create "Which command should I use?" guide

### Short-term (Month 1)
1. ✅ Standardize flag meanings across commands
2. ✅ Add tool selection guide
3. ✅ Clarify command descriptions

### Long-term (Future)
1. 🤔 Consider command consolidation or renaming
2. 🤔 Reorganize output directory structure
3. 🤔 Add interactive command selector tool

---

## Conclusion

The command system is **powerful but complex**. The main ambiguities stem from:
- Multiple commands with similar names serving different purposes
- Inconsistent parameter usage
- Unclear decision criteria for command selection

**Overall Assessment**: The codebase has a well-structured command system, but would benefit significantly from:
1. Better documentation (decision trees, use case examples)
2. Clearer naming conventions
3. Consistent parameter patterns
4. Safety warnings for destructive operations

**Risk Level**: MEDIUM - Experienced users can navigate, but new users will struggle. The YOLO execution commands pose the highest risk of accidental misuse.
