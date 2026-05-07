-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "adminJids" TEXT,
ADD COLUMN     "ownerJids" TEXT,
ADD COLUMN     "paymentProvider" TEXT,
ADD COLUMN     "qrisServerId" TEXT;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "botId" TEXT,
    "jid" TEXT,
    "chatId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMutation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balBefore" DOUBLE PRECISION NOT NULL,
    "balAfter" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "customerId" TEXT,
    "botId" TEXT,
    "qrisServerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qrString" TEXT,
    "paymentUrl" TEXT,
    "productCode" TEXT,
    "qty" INTEGER,
    "purpose" TEXT NOT NULL DEFAULT 'buynow',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "rawResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_ownerUserId_idx" ON "Customer"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_ownerUserId_jid_key" ON "Customer"("ownerUserId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_ownerUserId_chatId_key" ON "Customer"("ownerUserId", "chatId");

-- CreateIndex
CREATE INDEX "CustomerMutation_customerId_idx" ON "CustomerMutation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_orderId_key" ON "CustomerOrder"("orderId");

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_idx" ON "CustomerOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_ownerUserId_idx" ON "Payment"("ownerUserId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_qrisServerId_fkey" FOREIGN KEY ("qrisServerId") REFERENCES "QrisServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMutation" ADD CONSTRAINT "CustomerMutation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_qrisServerId_fkey" FOREIGN KEY ("qrisServerId") REFERENCES "QrisServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
