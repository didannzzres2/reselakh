"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  MessageSquare,
  Power,
  PowerOff,
  Send,
  Pencil,
} from "lucide-react";
import Spinner from "@/components/loading/Spinner";

interface BotData {
  id: string;
  type: string;
  name: string;
  token: string | null;
  phoneNumber: string | null;
  isAutoOrder: boolean;
  isNotification: boolean;
  isConnected: boolean;
  status: string;
  contactPerson: string | null;
  welcomeMsg: string | null;
  startBanner: string | null;
  ownerJids: string | null;
  adminJids: string | null;
  qrisServerId: string | null;
}

interface QrisServerOption {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
}

interface FormState {
  type: string;
  name: string;
  token: string;
  phoneNumber: string;
  isAutoOrder: boolean;
  isNotification: boolean;
  contactPerson: string;
  welcomeMsg: string;
  startBanner: string;
  ownerJids: string;
  adminJids: string;
  qrisServerId: string;
}

const emptyForm = (): FormState => ({
  type: "telegram",
  name: "",
  token: "",
  phoneNumber: "",
  isAutoOrder: true,
  isNotification: true,
  contactPerson: "",
  welcomeMsg: "",
  startBanner: "",
  ownerJids: "",
  adminJids: "",
  qrisServerId: "",
});

export default function BotsPage() {
  const [bots, setBots] = useState<BotData[]>([]);
  const [qrisServers, setQrisServers] = useState<QrisServerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    const [botsRes, qrisRes] = await Promise.all([
      fetch("/api/user/bots").then((r) => r.json()),
      fetch("/api/user/qris").then((r) => r.json()),
    ]);
    setBots(botsRes.bots || []);
    setQrisServers(qrisRes.servers || []);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setModal(true);
  };

  const openEdit = (bot: BotData) => {
    setEditingId(bot.id);
    setForm({
      type: bot.type,
      name: bot.name,
      token: bot.token || "",
      phoneNumber: bot.phoneNumber || "",
      isAutoOrder: bot.isAutoOrder,
      isNotification: bot.isNotification,
      contactPerson: bot.contactPerson || "",
      welcomeMsg: bot.welcomeMsg || "",
      startBanner: bot.startBanner || "",
      ownerJids: bot.ownerJids || "",
      adminJids: bot.adminJids || "",
      qrisServerId: bot.qrisServerId || "",
    });
    setError(null);
    setModal(true);
  };

  const handleSave = async () => {
    setError(null);
    const payload: Record<string, unknown> = {
      type: form.type,
      name: form.name,
      token: form.token || null,
      phoneNumber: form.phoneNumber || null,
      isAutoOrder: form.isAutoOrder,
      isNotification: form.isNotification,
      contactPerson: form.contactPerson || null,
      welcomeMsg: form.welcomeMsg || null,
      startBanner: form.startBanner || null,
      ownerJids: form.ownerJids || null,
      adminJids: form.adminJids || null,
      qrisServerId: form.qrisServerId || null,
    };
    const url = "/api/user/bots";
    const method = editingId ? "PATCH" : "POST";
    if (editingId) payload.id = editingId;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal menyimpan");
      return;
    }
    setModal(false);
    fetchData();
  };

  const handleBotAction = async (
    botId: string,
    type: string,
    action: string,
  ) => {
    const endpoint =
      type === "telegram" ? "/api/bot/telegram" : "/api/bot/whatsapp";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId, action }),
    });
    const data = await res.json();
    if (data.pairingCode) setPairingCode(data.pairingCode);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus bot ini?")) return;
    await fetch("/api/user/bots", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bot Management</h1>
          <p className="text-sm text-gray-500">
            Kelola bot Telegram dan WhatsApp
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium text-sm"
        >
          <Plus className="w-4 h-4" /> Tambah Bot
        </button>
      </div>

      {pairingCode && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-5"
        >
          <h3 className="font-bold text-blue-800 dark:text-blue-300 mb-2">
            Pairing Code WhatsApp
          </h3>
          <p className="text-3xl font-mono font-bold text-blue-600">
            {pairingCode}
          </p>
          <p className="text-sm text-blue-600/70 mt-2">
            Masukkan kode ini di WhatsApp: Settings &gt; Linked Devices &gt;
            Link with phone number
          </p>
          <button
            onClick={() => setPairingCode(null)}
            className="mt-3 px-4 py-2 rounded-lg bg-blue-100 text-blue-700 text-sm font-medium"
          >
            Tutup
          </button>
        </motion.div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          {bots.map((bot) => (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-xl flex items-center justify-center ${bot.type === "telegram" ? "bg-gradient-to-r from-blue-500 to-cyan-500" : "bg-gradient-to-r from-green-500 to-emerald-500"}`}
                  >
                    {bot.type === "telegram" ? (
                      <Send className="w-7 h-7 text-white" />
                    ) : (
                      <MessageSquare className="w-7 h-7 text-white" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg">{bot.name}</h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${bot.type === "telegram" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}
                      >
                        {bot.type}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                      <span>
                        Status:{" "}
                        <span
                          className={
                            bot.isConnected
                              ? "text-green-600 font-medium"
                              : "text-red-500"
                          }
                        >
                          {bot.isConnected ? "Connected" : "Disconnected"}
                        </span>
                      </span>
                      <span>
                        | Auto Order: {bot.isAutoOrder ? "ON" : "OFF"}
                      </span>
                      <span>
                        | Notifikasi: {bot.isNotification ? "ON" : "OFF"}
                      </span>
                      {bot.qrisServerId && <span>| QRIS: ON</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openEdit(bot)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-sm font-medium hover:bg-gray-200"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  {!bot.isConnected ? (
                    <button
                      onClick={() => handleBotAction(bot.id, bot.type, "start")}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-500 text-white text-sm font-medium"
                    >
                      <Power className="w-4 h-4" /> Start
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBotAction(bot.id, bot.type, "stop")}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium"
                    >
                      <PowerOff className="w-4 h-4" /> Stop
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(bot.id)}
                    className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-sm font-medium hover:bg-red-100 hover:text-red-600 transition"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
          {bots.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              Belum ada bot. Tambahkan bot pertama Anda!
            </p>
          )}
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">
                  {editingId ? "Edit Bot" : "Tambah Bot"}
                </h3>
                <button
                  onClick={() => setModal(false)}
                  className="p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                  disabled={!!editingId}
                >
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <input
                  placeholder="Nama Bot"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                {form.type === "telegram" ? (
                  <input
                    placeholder="Bot Token (dari @BotFather)"
                    value={form.token}
                    onChange={(e) =>
                      setForm({ ...form, token: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent font-mono text-sm"
                  />
                ) : (
                  <input
                    placeholder="Nomor WhatsApp (628xxxx)"
                    value={form.phoneNumber}
                    onChange={(e) =>
                      setForm({ ...form, phoneNumber: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                  />
                )}
                {form.type === "whatsapp" && (
                  <>
                    <textarea
                      placeholder="Owner JID (pisahkan dengan koma)&#10;Contoh: 6283175177108@s.whatsapp.net"
                      value={form.ownerJids}
                      onChange={(e) =>
                        setForm({ ...form, ownerJids: e.target.value })
                      }
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono resize-none"
                    />
                    <textarea
                      placeholder="Admin JID (pisahkan dengan koma)&#10;Harus diakhiri @s.whatsapp.net atau @lid"
                      value={form.adminJids}
                      onChange={(e) =>
                        setForm({ ...form, adminJids: e.target.value })
                      }
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm font-mono resize-none"
                    />
                  </>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    QRIS Server (untuk /buynow & /topup)
                  </label>
                  <select
                    value={form.qrisServerId}
                    onChange={(e) =>
                      setForm({ ...form, qrisServerId: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                  >
                    <option value="">— Tidak aktif —</option>
                    {qrisServers
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.provider})
                        </option>
                      ))}
                  </select>
                </div>
                <input
                  placeholder="Contact Person (opsional)"
                  value={form.contactPerson}
                  onChange={(e) =>
                    setForm({ ...form, contactPerson: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent"
                />
                <textarea
                  placeholder="Pesan Welcome tambahan (opsional, dipakai sebagai header /start)"
                  value={form.welcomeMsg}
                  onChange={(e) =>
                    setForm({ ...form, welcomeMsg: e.target.value })
                  }
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent resize-none"
                />
                {form.type === "telegram" && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Banner /start (URL gambar atau Telegram file_id)
                    </label>
                    <input
                      placeholder="https://… atau file_id"
                      value={form.startBanner}
                      onChange={(e) =>
                        setForm({ ...form, startBanner: e.target.value })
                      }
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-transparent text-sm"
                    />
                  </div>
                )}
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isAutoOrder}
                      onChange={(e) =>
                        setForm({ ...form, isAutoOrder: e.target.checked })
                      }
                      className="rounded"
                    />{" "}
                    Auto Order
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isNotification}
                      onChange={(e) =>
                        setForm({ ...form, isNotification: e.target.checked })
                      }
                      className="rounded"
                    />{" "}
                    Notifikasi
                  </label>
                </div>
                {error && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
                    {error}
                  </p>
                )}
                <button
                  onClick={handleSave}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium"
                >
                  {editingId ? "Simpan Perubahan" : "Tambah Bot"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
