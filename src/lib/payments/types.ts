/**
 * Common payment-gateway types shared by EQRIS and Pakasir adapters.
 */

export interface QrisServerLike {
  id: string;
  name: string;
  provider: string;
  apiKey: string | null;
  apiSecret: string | null;
  merchantId: string | null;
  config: string | null;
}

export interface CreateQrisRequest {
  amount: number;
  orderId: string;
  redirectUrl?: string | null;
}

export interface CreateQrisResult {
  ok: true;
  qrString: string | null;
  paymentUrl: string | null;
  expiresAt: Date | null;
  fee: number;
  totalAmount: number;
  raw: unknown;
}

export interface CreateQrisError {
  ok: false;
  error: string;
  raw?: unknown;
}

export interface CheckStatusResult {
  ok: true;
  status: "pending" | "completed" | "expired" | "cancelled" | "failed";
  paidAt: Date | null;
  raw: unknown;
}

export interface CheckStatusError {
  ok: false;
  error: string;
  raw?: unknown;
}

export type PaymentProvider = "eqris" | "pakasir";

export function parseConfig(server: QrisServerLike): Record<string, unknown> {
  if (!server.config) return {};
  try {
    const parsed = JSON.parse(server.config);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}
