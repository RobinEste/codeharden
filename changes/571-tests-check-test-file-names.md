---
section: fixed
---

- **The factory's `tests` check no longer fails pull requests whose tests are named by another convention.** It said "Code changed but no test files were added or updated" when the changed tests weren't `x.test.ts`, `x_test.go`, `test_x.py` or in a `test/`, `tests/`, `spec/` or `e2e/` folder, and each of those failures counted towards the pause after failures in a row. It now also knows .NET test projects (`App.Tests/`, `App.UnitTests/`), test classes (`OrderServiceTest.java`, `OrderTests.cs`, `OrderSpec.scala`), `x_test.rs`, `x_spec.rb`, `x-test.js`, `X.Tests.ps1`, `x.cy.ts`, `x.e2e-spec.ts`, Django's `tests.py`, `conftest.py`, `__snapshots__/` and folders such as `integration-tests/`. As before, a test file counts whether the pull request added, modified or renamed it.
