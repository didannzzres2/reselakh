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
 * Pakasir adapter — uses the API integration described at
 * https://pakasir.com/p/docs (section C).
 *
 * QrisServer config:
 *   apiKey      — Pakasir API key (per-project)
 *   merchantId  — Pakasir project slug (e.g. `depodomain`)
 *   config.baseUrl   — defaults to `https://app.pakasir.com`
 *   config.method    — defaults to `qris`
 */

const DEFAULT_BASE_URL = "https://app.pakasir.com";
const DEFAULT_METHOD = "qris";

interface PakasirCreateResponse {
  payment?: {
    project?: string;
    order_id?: string;
    amount?: number;
    fee?: number;
    total_payment?: number;
    payment_method?: string;
    payment_number?: string;
    expired_at?: string;
    [key: string]: unknown;
  };
  error?: string;
  message?: string;
  [key: string]: unknown;
}

interface PakasirStatusResponse {
  transaction?: {
    amount?: number;
    order_id?: string;
    project?: string;
    status?: string;
    payment_method?: string;
    completed_at?: string;
    [key: string]: unknown;
  };
  error?: string;
  message?: string;
  [key: string]: unknown;
}

function getBaseUrl(server: QrisServerLike): string {
  const cfg = parseConfig(server);
  const url = typeof cfg.baseUrl === "string" ? cfg.baseUrl : null;
  return (url || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getMethod(server: QrisServerLike): string {
  const cfg = parseConfig(server);
  return typeof cfg.method === "string" ? cfg.method : DEFAULT_METHOD;
}

export async function createQris(
  server: QrisServerLike,
  req: CreateQrisRequest,
): Promise<CreateQrisResult | CreateQrisError> {
  if (!server.apiKey) {
    return { ok: false, error: "Pakasir apiKey belum diatur" };
  }
  if (!server.merchantId) {
    return {
      ok: false,
      error: "Pakasir project (merchantId) belum diatur",
    };
  }

  const method = getMethod(server);
  const url = `${getBaseUrl(server)}/api/transactioncreate/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        project: server.merchantId,
        order_id: req.orderId,
        amount: Math.round(req.amount),
        api_key: server.apiKey,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Pakasir request gagal: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let body: PakasirCreateResponse | null = null;
  try {
    body = (await res.json()) as PakasirCreateResponse;
  } catch {
    return {
      ok: false,
      error: `Pakasir response tidak valid (HTTP ${res.status})`,
    };
  }

  if (!res.ok || !body?.payment) {
    return {
      ok: false,
      error: body?.error || body?.message || `Pakasir HTTP ${res.status}`,
      raw: body,
    };
  }

  const payment = body.payment;
  const qrString =
    typeof payment.payment_number === "string" ? payment.payment_number : null;

  // Pakasir hosted-page URL pattern (works regardless of API integration):
  //   https://app.pakasir.com/pay/{slug}/{amount}?order_id=...&qris_only=1
  const hostedUrl = new URL(
    `${getBaseUrl(server)}/pay/${encodeURIComponent(server.merchantId)}/${Math.round(req.amount)}`,
  );
  hostedUrl.searchParams.set("order_id", req.orderId);
  if (method === "qris") hostedUrl.searchParams.set("qris_only", "1");
  if (req.redirectUrl) hostedUrl.searchParams.set("redirect", req.redirectUrl);

  const expiredRaw =
    typeof payment.expired_at === "string" ? payment.expired_at : null;
  const expiresAt = expiredRaw ? new Date(expiredRaw) : null;

  const totalAmount =
    typeof payment.total_payment === "number"
      ? payment.total_payment
      : Math.round(req.amount);
  const fee = typeof payment.fee === "number" ? payment.fee : 0;

  return {
    ok: true,
    qrString,
    paymentUrl: hostedUrl.toString(),
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    fee,
    totalAmount,
    raw: body,
  };
}

export async function checkStatus(
  server: QrisServerLike,
  orderId: string,
  amount: number,
): Promise<CheckStatusResult | CheckStatusError> {
  if (!server.apiKey || !server.merchantId) {
    return {
      ok: false,
      error: "Pakasir credential (apiKey/project) belum lengkap",
    };
  }

  const url = new URL(`${getBaseUrl(server)}/api/transactiondetail`);
  url.searchParams.set("project", server.merchantId);
  url.searchParams.set("amount", String(Math.round(amount)));
  url.searchParams.set("order_id", orderId);
  url.searchParams.set("api_key", server.apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET" });
  } catch (err) {
    return {
      ok: false,
      error: `Pakasir request gagal: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let body: PakasirStatusResponse | null = null;
  try {
    body = (await res.json()) as PakasirStatusResponse;
  } catch {
    return {
      ok: false,
      error: `Pakasir response tidak valid (HTTP ${res.status})`,
    };
  }

  if (!res.ok || !body?.transaction) {
    return {
      ok: false,
      error: body?.error || body?.message || `Pakasir HTTP ${res.status}`,
      raw: body,
    };
  }

  const raw = body.transaction.status?.toLowerCase?.() ?? "pending";
  let status: CheckStatusResult["status"] = "pending";
  if (raw === "completed" || raw === "paid" || raw === "success") {
    status = "completed";
  } else if (raw === "expired") {
    status = "expired";
  } else if (raw === "cancelled" || raw === "canceled") {
    status = "cancelled";
  } else if (raw === "failed") {
    status = "failed";
  }

  const completedRaw =
    typeof body.transaction.completed_at === "string"
      ? body.transaction.completed_at
      : null;
  const paidAt = completedRaw ? new Date(completedRaw) : null;

  return {
    ok: true,
    status,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
    raw: body,
  };
}
