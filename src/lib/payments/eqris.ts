import {
  CheckStatusError,
  CheckStatusResult,
  CreateQrisError,
  CreateQrisRequest,
  CreateQrisResult,
  parseConfig,
  QrisServerLike,
} from "./types";

/**
 * EQRIS (eqris.com) Gomerch dynamic-QRIS adapter.
 *
 * Required QrisServer fields:
 *   apiKey  — token for `Authorization: Bearer ...`
 * Optional `config` JSON keys:
 *   baseUrl  — defaults to `https://eqris.com`
 *
 * Reference: https://eqris.com/api-docs/
 */

const DEFAULT_BASE_URL = "https://eqris.com";

interface EqrisQrisResponse {
  status?: string | boolean;
  message?: string;
  data?: {
    qrString?: string;
    qr_string?: string;
    qrImage?: string;
    qr_image?: string;
    paymentUrl?: string;
    payment_url?: string;
    expiredAt?: string;
    expired_at?: string;
    fee?: number;
    totalAmount?: number;
    total_amount?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface EqrisStatusResponse {
  status?: string | boolean;
  data?: {
    status?: string;
    paidAt?: string;
    paid_at?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function getBaseUrl(server: QrisServerLike): string {
  const cfg = parseConfig(server);
  const url = typeof cfg.baseUrl === "string" ? cfg.baseUrl : null;
  return (url || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function authHeaders(server: QrisServerLike): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (server.apiKey) {
    headers.Authorization = `Bearer ${server.apiKey}`;
  }
  return headers;
}

export async function createQris(
  server: QrisServerLike,
  req: CreateQrisRequest,
): Promise<CreateQrisResult | CreateQrisError> {
  if (!server.apiKey) {
    return { ok: false, error: "EQRIS apiKey belum diatur" };
  }

  const url = `${getBaseUrl(server)}/api/gomerch-transaksi/qris`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(server),
      body: JSON.stringify({
        order_id: req.orderId,
        amount: Math.round(req.amount),
        merchant_id: server.merchantId ?? undefined,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `EQRIS request gagal: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let body: EqrisQrisResponse | null = null;
  try {
    body = (await res.json()) as EqrisQrisResponse;
  } catch {
    return {
      ok: false,
      error: `EQRIS response tidak valid (HTTP ${res.status})`,
    };
  }

  if (!res.ok || body?.status === false || body?.status === "error") {
    return {
      ok: false,
      error: body?.message || `EQRIS HTTP ${res.status}`,
      raw: body,
    };
  }

  const data = body?.data ?? {};
  const qrString =
    (typeof data.qrString === "string" && data.qrString) ||
    (typeof data.qr_string === "string" && data.qr_string) ||
    null;
  const paymentUrl =
    (typeof data.paymentUrl === "string" && data.paymentUrl) ||
    (typeof data.payment_url === "string" && data.payment_url) ||
    (typeof data.qrImage === "string" && data.qrImage) ||
    (typeof data.qr_image === "string" && data.qr_image) ||
    null;

  if (!qrString && !paymentUrl) {
    return {
      ok: false,
      error: "EQRIS tidak mengembalikan QR string / payment URL",
      raw: body,
    };
  }

  const expiredRaw =
    (typeof data.expiredAt === "string" && data.expiredAt) ||
    (typeof data.expired_at === "string" && data.expired_at) ||
    null;
  const expiresAt = expiredRaw ? new Date(expiredRaw) : null;

  const totalAmount =
    typeof data.totalAmount === "number"
      ? data.totalAmount
      : typeof data.total_amount === "number"
        ? data.total_amount
        : Math.round(req.amount);
  const fee = typeof data.fee === "number" ? data.fee : 0;

  return {
    ok: true,
    qrString,
    paymentUrl,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    fee,
    totalAmount,
    raw: body,
  };
}

export async function checkStatus(
  server: QrisServerLike,
  orderId: string,
): Promise<CheckStatusResult | CheckStatusError> {
  if (!server.apiKey) {
    return { ok: false, error: "EQRIS apiKey belum diatur" };
  }

  const url = `${getBaseUrl(server)}/api/gomerch-transaksi/status`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(server),
      body: JSON.stringify({
        order_id: orderId,
        merchant_id: server.merchantId ?? undefined,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `EQRIS request gagal: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let body: EqrisStatusResponse | null = null;
  try {
    body = (await res.json()) as EqrisStatusResponse;
  } catch {
    return {
      ok: false,
      error: `EQRIS response tidak valid (HTTP ${res.status})`,
    };
  }

  if (!res.ok) {
    return { ok: false, error: `EQRIS HTTP ${res.status}`, raw: body };
  }

  const rawStatus = body?.data?.status?.toLowerCase?.() ?? "";
  let status: CheckStatusResult["status"] = "pending";
  if (
    rawStatus === "paid" ||
    rawStatus === "completed" ||
    rawStatus === "settled" ||
    rawStatus === "success"
  ) {
    status = "completed";
  } else if (rawStatus === "expired") {
    status = "expired";
  } else if (rawStatus === "cancelled" || rawStatus === "canceled") {
    status = "cancelled";
  } else if (rawStatus === "failed") {
    status = "failed";
  }

  const paidRaw =
    (typeof body?.data?.paidAt === "string" && body.data.paidAt) ||
    (typeof body?.data?.paid_at === "string" && body.data.paid_at) ||
    null;
  const paidAt = paidRaw ? new Date(paidRaw) : null;

  return {
    ok: true,
    status,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
    raw: body,
  };
}
