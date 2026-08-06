-- CreateTable
CREATE TABLE "exchange_rate_history" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "usdVesOficial" DECIMAL(14,4) NOT NULL,
    "usdVesParalelo" DECIMAL(14,4),
    "eurUsd" DECIMAL(14,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_history_day_key" ON "exchange_rate_history"("day");
