import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createInvoice, InvoiceFormData } from "@/lib/invoices";

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  prefilledData?: Partial<InvoiceFormData>;
}

export default function InvoiceModal({
  isOpen,
  onClose,
  onCreated,
  prefilledData,
}: InvoiceModalProps) {
  const [formData, setFormData] = useState<InvoiceFormData>({
    clientName: "",
    clientEmail: "",
    description: "",
    amount: "",
    asset: "XLM",
    dueDate: "",
    notes: "",
    transactionHash: "",
    fromAddress: "",
    toAddress: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && prefilledData) {
      setFormData((prev) => ({
        ...prev,
        ...prefilledData,
        dueDate: prefilledData.dueDate || getDefaultDueDate(),
      }));
    }
  }, [isOpen, prefilledData]);

  function getDefaultDueDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString().split("T")[0];
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.clientName.trim()) newErrors.clientName = "Client name is required";
    if (!formData.clientEmail.trim()) {
      newErrors.clientEmail = "Client email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.clientEmail)) {
      newErrors.clientEmail = "Invalid email address";
    }
    if (!formData.description.trim()) newErrors.description = "Description is required";
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      newErrors.amount = "Valid amount is required";
    }
    if (!formData.dueDate) newErrors.dueDate = "Due date is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      createInvoice(formData);
      onCreated();
      onClose();
      setFormData({
        clientName: "",
        clientEmail: "",
        description: "",
        amount: "",
        asset: "XLM",
        dueDate: "",
        notes: "",
        transactionHash: "",
        fromAddress: "",
        toAddress: "",
      });
      setErrors({});
    } catch (err) {
      console.error("Failed to create invoice:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/95 p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/95 max-h-[90vh] overflow-y-auto"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Generate Invoice
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Create a professional invoice for this transaction
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Client Name *
                  </label>
                  <input
                    type="text"
                    name="clientName"
                    value={formData.clientName}
                    onChange={handleChange}
                    placeholder="e.g. Acme Corp"
                    className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 dark:bg-slate-800 dark:text-white ${
                      errors.clientName
                        ? "border-red-500 focus:border-red-500"
                        : "border-slate-200 focus:border-stellar-500 dark:border-slate-700"
                    }`}
                  />
                  {errors.clientName && (
                    <p className="mt-1 text-xs text-red-500">{errors.clientName}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Client Email *
                  </label>
                  <input
                    type="email"
                    name="clientEmail"
                    value={formData.clientEmail}
                    onChange={handleChange}
                    placeholder="client@example.com"
                    className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 dark:bg-slate-800 dark:text-white ${
                      errors.clientEmail
                        ? "border-red-500 focus:border-red-500"
                        : "border-slate-200 focus:border-stellar-500 dark:border-slate-700"
                    }`}
                  />
                  {errors.clientEmail && (
                    <p className="mt-1 text-xs text-red-500">{errors.clientEmail}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Description *
                </label>
                <input
                  type="text"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="e.g. Web Development Services"
                  className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 dark:bg-slate-800 dark:text-white ${
                    errors.description
                      ? "border-red-500 focus:border-red-500"
                      : "border-slate-200 focus:border-stellar-500 dark:border-slate-700"
                  }`}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-500">{errors.description}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Amount *
                  </label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                    step="0.0000001"
                    min="0"
                    placeholder="0.00"
                    className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 dark:bg-slate-800 dark:text-white ${
                      errors.amount
                        ? "border-red-500 focus:border-red-500"
                        : "border-slate-200 focus:border-stellar-500 dark:border-slate-700"
                    }`}
                  />
                  {errors.amount && (
                    <p className="mt-1 text-xs text-red-500">{errors.amount}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Asset
                  </label>
                  <select
                    name="asset"
                    value={formData.asset}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-stellar-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                    <option value="EURC">EURC</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Due Date *
                </label>
                <input
                  type="date"
                  name="dueDate"
                  value={formData.dueDate}
                  onChange={handleChange}
                  className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors dark:bg-slate-800 dark:text-white ${
                    errors.dueDate
                      ? "border-red-500 focus:border-red-500"
                      : "border-slate-200 focus:border-stellar-500 dark:border-slate-700"
                  }`}
                />
                {errors.dueDate && (
                  <p className="mt-1 text-xs text-red-500">{errors.dueDate}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Additional notes for the client..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-stellar-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {formData.transactionHash && (
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Linked Transaction
                  </label>
                  <p className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all">
                    {formData.transactionHash}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-xl bg-stellar-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-stellar-500/30 transition-all hover:bg-stellar-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Creating...
                    </span>
                  ) : (
                    "Create Invoice"
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}