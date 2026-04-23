## Linked Issue

Closes #

## What Changed

- 

## Risk / Rollback

- Risk:
- Rollback:

## Checks

- [ ] `cd agent && go test ./...`
- [ ] `python3 harness/test_output_validator.py`
- [ ] `helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password`

