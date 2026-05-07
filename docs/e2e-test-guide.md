# End-to-End Test Case - Sprint 5

## Test Objective
Validate the complete flow from init to deploy using a simple backend API test case.

## Test Case: Simple Appointment Management API

### Why This Test Case?
- Product type is unambiguous (REST API)
- AWS architecture is predictable (Lambda + API Gateway + DynamoDB)
- Module decomposition is natural (endpoints = modules)
- Interface contracts are explicit (request/response schemas)
- Deployment is simple (CDK with Lambda)

## Pre-Test Setup

### 1. Create Source Repository with Business Documents

Create a repo `test-appointment-system-docs` with the following documents:

**README.md:**
```markdown
# Appointment Management System

A simple REST API for managing appointments.

## Features
- Create new appointments
- List all appointments
- Get appointment details
- Update appointment status
- Cancel appointments
```

**docs/business-rules.md:**
```markdown
## Business Rules

1. Appointments can only be scheduled during business hours (9 AM - 6 PM, Monday-Friday)
2. An appointment cannot be scheduled in the past
3. Each appointment must have: customer name, email, service type, date, and time
4. Appointment durations are fixed at 30 minutes
5. Customers cannot have more than 3 appointments in a single day
6. Cancellation is allowed up to 2 hours before the appointment
```

**docs/user-flows.md:**
```markdown
## User Flows

### Flow 1: Schedule Appointment
1. Customer provides name, email, service type
2. System displays available slots for the selected date
3. Customer selects a time slot
4. System creates appointment and sends confirmation email

### Flow 2: View Appointments
1. Customer provides email
2. System returns all upcoming appointments for that customer

### Flow 3: Cancel Appointment
1. Customer requests cancellation with appointment ID
2. System verifies cancellation is allowed (2+ hours before)
3. System marks appointment as cancelled
```

**docs/entities.md:**
```markdown
## Entities

### Appointment
- id: UUID
- customerName: string
- customerEmail: string
- serviceType: enum (consultation, followup, emergency)
- date: date
- time: time
- status: enum (scheduled, confirmed, completed, cancelled)
- createdAt: datetime
- updatedAt: datetime

### Customer
- email: string (unique)
- name: string
- phone: string (optional)
```

## Test Execution Steps

### Step 1: Initialize the Project
```bash
savante-orch init --source owner/test-appointment-system-docs --target owner/test-appointment-system-api
```

**Expected Result:**
- Connected to GitHub
- Source repo accessible
- Target repo created
- `_orchestrator` branch initialized with state

### Step 2: Start Analysis
```bash
savante-orch start --target owner/test-appointment-system-api
```

**Expected Result:**
- Analyst agent reads all business documents
- Domain document generated
- Document committed to `docs/domain-analysis.md`
- Gate 1 (AWAITING_DOMAIN_APPROVAL) triggered

### Step 3: Approve Domain
```bash
savante-orch approve --gate domain --target owner/test-appointment-system-api
```

**Expected Result:**
- Domain approved
- Architect agent starts
- Architecture document generated
- Document committed to `docs/architecture-analysis.md`
- Gate 2 (AWAITING_TECH_APPROVAL) triggered

### Step 4: Approve Architecture
```bash
savante-orch approve --gate architecture --target owner/test-appointment-system-api
```

**Expected Result:**
- Architecture approved
- Planner agent creates development plan
- Plan committed to `docs/development-plan.json`
- Developer agents start (DEVELOPING phase)

### Step 5: Resume for Development
```bash
savante-orch resume --target owner/test-appointment-system-api
```

**Expected Result:**
- Developer agents create code for each module
- Branches created: `feature/module-{name}`
- PRs opened for each module
- Review phase starts (REVIEWING_CODE)

### Step 6: Check Reviews
```bash
savante-orch resume --target owner/test-appointment-system-api
```

**Expected Result:**
- Reviewer agents review each PR
- PRs approved or changes requested
- If all approved, integration starts (INTEGRATING)

### Step 7: Verify Integration (Gate 3)
```bash
savante-orch status --target owner/test-appointment-system-api
```

**Expected Result:**
- Integrator agent merges PRs in dependency order
- All PRs merged to main branch
- Gate 3 (AWAITING_CODE_APPROVAL) triggered

### Step 8: Approve Code
```bash
savante-orch approve --gate code --target owner/test-appointment-system-api
```

**Expected Result:**
- Code approved
- Deployment starts (DEPLOYING)
- Deployer agent runs deployment commands

### Step 9: Verify Deployment (Gate 4)
```bash
savante-orch status --target owner/test-appointment-system-api
```

**Expected Result:**
- Application deployed
- Health checks performed
- Gate 4 (AWAITING_DEPLOY_APPROVAL) triggered

### Step 10: Approve Deployment
```bash
savante-orch approve --gate deploy --target owner/test-appointment-system-api
```

**Expected Result:**
- Deployment approved
- Process completed (COMPLETED)
- ✅ All gates passed

## Verification Checklist

- [ ] Domain document created with entities, flows, rules, ambiguities
- [ ] Architecture document created with AWS stack, costs
- [ ] Development plan created with modules, contracts, execution order
- [ ] Developer agents create code in isolated branches
- [ ] PRs opened for each module
- [ ] Reviewer agents evaluate PRs against specs
- [ ] Integrator merges PRs in dependency order
- [ ] No merge conflicts (or conflicts resolved)
- [ ] Code gate triggered for human approval
- [ ] Deployer runs deployment commands
- [ ] Health checks pass
- [ ] Deploy gate triggered for human approval
- [ ] Process completes successfully

## Expected PRs to be Created

Based on the entities and flows, expected modules:
1. **Appointments Module** - CRUD operations for appointments
2. **Customers Module** - Customer management
3. **Availability Module** - Slot calculation and availability checking

## Expected AWS Stack (from Architecture Document)

- API Gateway (REST API)
- Lambda functions (one per endpoint or per module)
- DynamoDB table (Appointments, Customers)
- CloudWatch (logging)
- SNS/SQS (confirmation emails)

## Notes

- The goal is NOT for the generated code to be perfect
- The goal is to validate that:
  - Gates work correctly
  - Agents coordinate properly
  - Human has real control over the process
  - State persists and resumes correctly
  - Integration merges in correct order
  - Deployment runs successfully

## Troubleshooting

### If a Gate is Rejected
```bash
savante-orch reject --gate {gate} --feedback "Your feedback" --target owner/test-appointment-system-api
savante-orch resume --target owner/test-appointment-system-api
```

### If Process Needs to be Resumed
```bash
savante-orch resume --target owner/test-appointment-system-api
```

### To Check State at Any Point
```bash
savante-orch status --target owner/test-appointment-system-api
```
