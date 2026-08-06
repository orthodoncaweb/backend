-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('RECIBIDO', 'EN_PREPARACION', 'ENVIADO');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'RECIBIDO';
