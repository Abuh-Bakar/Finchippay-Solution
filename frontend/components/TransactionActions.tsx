/**
 * components/TransactionActions.tsx
 * Action buttons for transaction detail page
 */

import { useState } from "react";
import { explorerUrl } from "@/lib/stellar";
import { copyToClipboard } from "@/utils/format";
import { ExternalLinkIcon, CopyIcon, CheckIcon, PrinterIcon } from "@/components/icons";
import { generatePDFReceipt } from "@/lib/generatePDF";
import { motion } from "framer-motion";

interface TransactionActionsProps {
  transactionHash: string;
  transaction: any;
}

export default function TransactionActions({
  transactionHash,
  transaction,
}: TransactionActionsProps) {
  const [copiedHash, setCopiedHash] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  const handleCopyHash = async () => {
    const success = await copyToClipboard(transactionHash);
    if (success) {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    const shareUrl = `${window.location.origin}/tx/${transactionHash}`;

    // Use Web Share API if available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Transaction Receipt",
          text: `View transaction on Finchippay`,
          url: shareUrl,
        });
      } catch (err) {
        // User cancelled or share failed
        console.log("Share cancelled");
      }
    } else {
      // Fallback: copy link to clipboard
      await copyToClipboard(shareUrl);
    }
    setSharing(false);
  };

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      await generatePDFReceipt(transaction);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      alert("Failed to generate PDF receipt. Please try again.");
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleViewOnExplorer = () => {
    const url = explorerUrl(transactionHash);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Actions
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* View on Explorer */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleViewOnExplorer}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px]"
        >
          <ExternalLinkIcon className="w-5 h-5" />
          View on Explorer
        </motion.button>

        {/* Copy Hash */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleCopyHash}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px]"
        >
          {copiedHash ? (
            <>
              <CheckIcon className="w-5 h-5 text-emerald-500" />
              Copied!
            </>
          ) : (
            <>
              <CopyIcon className="w-5 h-5" />
              Copy Hash
            </>
          )}
        </motion.button>

        {/* Share Receipt */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-900 dark:text-white font-medium text-sm transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
            />
          </svg>
          {sharing ? "Sharing..." : "Share Receipt"}
        </motion.button>

        {/* Download PDF */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleDownloadPDF}
          disabled={generatingPDF}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stellar-500/10 hover:bg-stellar-500/20 text-stellar-700 dark:text-stellar-400 font-medium text-sm transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generatingPDF ? (
            <>
              <div className="w-5 h-5 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <PrinterIcon className="w-5 h-5" />
              Download PDF
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}