import { useState } from "react";
import { toast } from "sonner";
import { Check, Link2, Loader2 } from "lucide-react";
import { copyText } from "../lib/freshcheck";
import { buildShareUrl } from "../lib/share";

// ds-allow-hardcode:start Tailwind palette classes match the other components.
export const ShareButton = ({ report, variant = "primary", className = "" }) => {
  const [state, setState] = useState("idle"); // idle | busy | copied

  const share = async () => {
    setState("busy");
    try {
      const url = await buildShareUrl(report);
      // Phones get the native share sheet; desktops get the link on the clipboard.
      if (navigator.share && window.matchMedia?.("(pointer: coarse)").matches) {
        await navigator.share({ title: "FreshCheck report", text: "Which facts in this AI answer are stale:", url }).catch(() => {});
        setState("idle");
        return;
      }
      await copyText(url);
      setState("copied");
      toast.success("Report link copied. Anyone with it sees this report.");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
      toast.error("Couldn't build the share link");
    }
  };

  const styles = variant === "primary"
    ? "nm-btn-primary text-white px-5 py-2.5 text-sm font-bold"
    : "nm-btn text-slate-700 hover:text-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold";

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === "busy"}
      data-testid="btn-share-report"
      className={`inline-flex items-center gap-2 rounded-full transition-all disabled:opacity-60 ${styles} ${className}`}
    >
      {state === "busy" ? <Loader2 className="w-4 h-4 animate-spin" /> : state === "copied" ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
      {state === "copied" ? "Link copied" : "Share report"}
    </button>
  );
};
// ds-allow-hardcode:end
