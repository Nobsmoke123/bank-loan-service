/*
  Warnings:

  - You are about to alter the column `amount` on the `loans` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(14,4)`.
  - You are about to alter the column `outstandingBalance` on the `loans` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(14,4)`.

*/
-- AlterTable
ALTER TABLE "loans" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "outstandingBalance" SET DATA TYPE DECIMAL(14,4);
