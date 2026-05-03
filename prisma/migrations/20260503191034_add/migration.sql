-- This is an empty migration.

CREATE UNIQUE INDEX one_open_loan_per_user
ON "loans" ("user_id")
WHERE status IN ('ACTIVE', 'PENDING');