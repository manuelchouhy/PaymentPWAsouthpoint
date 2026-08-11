# QA Checklist

## Before Implementation

- [ ] Requirements clarified
- [ ] PRD created or updated
- [ ] Task selected
- [ ] Deployment target confirmed
- [ ] Risks identified

## During Implementation

- [ ] Small focused change
- [ ] No unrelated files modified
- [ ] Tests added or updated
- [ ] New dependencies are ≥14 days old (or explicitly approved)
- [ ] DOMO iframe constraints respected
- [ ] Firebase/Azure target respected

## Automated QA

- [ ] Unit tests run
- [ ] Type checks run
- [ ] Lint run
- [ ] Playwright tests run where relevant

## Manual QA

- [ ] Main user flow tested
- [ ] Edge cases tested
- [ ] Empty/loading/error states tested
- [ ] Permissions/role behavior tested where relevant
- [ ] Deployment risks reviewed

## Completion Report

- [ ] Changed files listed
- [ ] Tests run listed
- [ ] Known risks listed
- [ ] Manual QA steps listed
- [ ] Human approval requested if deployment is needed