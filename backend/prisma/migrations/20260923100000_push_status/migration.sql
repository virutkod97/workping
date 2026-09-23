ALTER TABLE "WebPushSubscription" ADD COLUMN "lastOkAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastErrorAt" TIMESTAMP(3);
