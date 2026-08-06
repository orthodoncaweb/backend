-- DropIndex
DROP INDEX "orders_status_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "exchangeRateAtCreation" DECIMAL(14,4);

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
