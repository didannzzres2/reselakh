-- Drop redundant Bot.paymentProvider column. Provider is now always derived
-- from `Bot.qrisServerId -> QrisServer.provider`.
ALTER TABLE "Bot" DROP COLUMN IF EXISTS "paymentProvider";
