import * as eqris from "./eqris";
import * as pakasir from "./pakasir";
import {
  CheckStatusError,
  CheckStatusResult,
  CreateQrisError,
  CreateQrisRequest,
  CreateQrisResult,
  PaymentProvider,
  QrisServerLike,
} from "./types";

export type { CreateQrisRequest, CreateQrisResult, CreateQrisError, CheckStatusResult, CheckStatusError, PaymentProvider, QrisServerLike };

function normaliseProvider(provider: string | null | undefined): PaymentProvider | null {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p === "eqris" || p === "pakasir") return p;
  return null;
}

export function isSupportedProvider(provider: string | null | undefined): provider is PaymentProvider {
  return normaliseProvider(provider) !== null;
}

export async function createQris(
  server: QrisServerLike,
  req: CreateQrisRequest,
): Promise<CreateQrisResult | CreateQrisError> {
  const provider = normaliseProvider(server.provider);
  if (provider === "eqris") return eqris.createQris(server, req);
  if (provider === "pakasir") return pakasir.createQris(server, req);
  return {
    ok: false,
    error: `Provider QRIS '${server.provider}' belum didukung (eqris | pakasir)`,
  };
}

export async function checkStatus(
  server: QrisServerLike,
  orderId: string,
  amount: number,
): Promise<CheckStatusResult | CheckStatusError> {
  const provider = normaliseProvider(server.provider);
  if (provider === "eqris") return eqris.checkStatus(server, orderId);
  if (provider === "pakasir") return pakasir.checkStatus(server, orderId, amount);
  return {
    ok: false,
    error: `Provider QRIS '${server.provider}' belum didukung`,
  };
}

/**
 * Generate a short, idempotent order id used as the gateway-facing reference.
 * Pattern: `RS-<timestamp36>-<random5>` (~14-16 chars). Pakasir slug imposes
 * fewer than 64-char limits; staying conservatively short.
 */
export function generateOrderId(prefix = "RS"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}
