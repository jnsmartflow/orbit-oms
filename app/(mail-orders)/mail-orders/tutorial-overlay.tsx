"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X } from "lucide-react";

// ── Tutorial step definitions ─────────────────────────────────────────────────

interface TutorialStep {
  /** CSS selector for the element to spotlight. null = centered overlay (no spotlight). */
  target: string | null;
  title: string;
  /** Supports HTML for kbd tags */
  description: string;
  /** Where tooltip appears relative to spotlight */
  position: "below" | "right" | "left" | "center";
}

const STEPS: TutorialStep[] = [
  {
    target: "[data-tutorial='view-toggle']",
    title: "Switch views",
    description:
      "Toggle between <b>Table</b> (full spreadsheet) and <b>Focus</b> (split-panel for speed punching). Focus is the default view.",
    position: "below",
  },
  {
    target: "[data-tutorial='slot-segments']",
    title: "Filter by time slot",
    description:
      "Orders are grouped by arrival time. Click a slot to filter, click again to show all. Press <kbd>1</kbd>–<kbd>4</kbd> to jump quickly.",
    position: "below",
  },
  {
    target: "[data-tutorial='order-list']",
    title: "Order list",
    description:
      "All orders for the selected slot. Press <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> to move between orders. Press <kbd>N</kbd> to jump to next unmatched.",
    position: "right",
  },
  {
    target: "[data-tutorial='detail-header']",
    title: "Customer & match status",
    description:
      "Shows customer name, code, and match status. If unmatched or multiple, press <kbd>P</kbd> to open the customer picker.",
    position: "below",
  },
  {
    target: "[data-tutorial='sku-table']",
    title: "SKU lines",
    description:
      "Each row is one product line from the email. Press <kbd>↑</kbd> <kbd>↓</kbd> to navigate lines. The yellow highlight shows your current position.",
    position: "below",
  },
  {
    target: "[data-tutorial='sku-table']",
    title: "Mark found / not found",
    description:
      "Press <kbd>Space</kbd> to toggle found/not-found on the active line. Then press <kbd>1</kbd>–<kbd>5</kbd> to select the reason.",
    position: "below",
  },
  {
    target: "[data-tutorial='so-input']",
    title: "Smart copy → paste → punch",
    description:
      "<kbd>Ctrl+C</kbd> once → copies customer code<br/><kbd>Ctrl+C</kbd> again → copies all SKUs<br/><kbd>Ctrl+V</kbd> → focuses this input<br/>Type the 10-digit SO number → auto-punches the order.",
    position: "below",
  },
  {
    target: null,
    title: "Keyboard shortcuts",
    description:
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:1px 10px;line-height:2">' +
      "<kbd>Tab</kbd><span>Next order</span>" +
      "<kbd>↑↓</kbd><span>Navigate lines</span>" +
      "<kbd>Space</kbd><span>Toggle found/not-found</span>" +
      "<kbd>Ctrl+C</kbd><span>Smart copy (code → SKUs)</span>" +
      "<kbd>Ctrl+V</kbd><span>Paste into SO input</span>" +
      "<kbd>N</kbd><span>Next unmatched order</span>" +
      "<kbd>F</kbd><span>Flag / lock order</span>" +
      "<kbd>R</kbd><span>Copy reply template</span>" +
      "<kbd>E</kbd><span>Open slot email</span>" +
      "<kbd>T</kbd><span>Show/hide punched orders</span>" +
      "<kbd>?</kbd><span>Show this tutorial again</span>" +
      "</div>",
    position: "center",
  },
];

// ── Timing constants ──────────────────────────────────────────────────────────

const TUTORIAL_FIRST_LOGIN_KEY = "mo-tutorial-first-login";
const TUTORIAL_DISMISSED_DATE_KEY = "mo-tutorial-dismissed-date";
const AUTO_SHOW_DAYS = 7;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function shouldAutoShow(): boolean {
  try {
    const firstLogin = localStorage.getItem(TUTORIAL_FIRST_LOGIN_KEY);
    if (!firstLogin) {
      // First ever visit — store timestamp and show
      localStorage.setItem(TUTORIAL_FIRST_LOGIN_KEY, new Date().toISOString());
      return true;
    }

    // Check if within 7-day window
    const firstDate = new Date(firstLogin);
    const now = new Date();
    const daysSinceFirst = (now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceFirst >= AUTO_SHOW_DAYS) return false;

    // Within 7 days — check if already dismissed today
    const dismissedDate = localStorage.getItem(TUTORIAL_DISMISSED_DATE_KEY);
    const today = getTodayDateString();
    if (dismissedDate === today) return false;

    return true;
  } catch {
    return false;
  }
}

function markDismissedToday(): void {
  try {
    localStorage.setItem(TUTORIAL_DISMISSED_DATE_KEY, getTodayDateString());
  } catch { /* ignore */ }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TutorialOverlayProps {
  /** External trigger to open (e.g. from ? key). Parent sets true, component resets via onClose. */
  manualTrigger?: boolean;
  onClose?: () => void;
}

export function TutorialOverlay({ manualTrigger, onClose }: TutorialOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Auto-show on mount (first 7 days, once per day)
  useEffect(() => {
    // Small delay to let the page render so target elements exist
    const timer = setTimeout(() => {
      if (shouldAutoShow()) {
        setVisible(true);
        setCurrentStep(0);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Manual trigger from parent (? key)
  useEffect(() => {
    if (manualTrigger) {
      setVisible(true);
      setCurrentStep(0);
    }
  }, [manualTrigger]);

  // Position spotlight on current step's target element
  const updateSpotlight = useCallback(() => {
    const step = STEPS[currentStep];
    if (!step.target) {
      setSpotlightRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setSpotlightRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setSpotlightRect(rect);
  }, [currentStep]);

  useEffect(() => {
    if (!visible) return;
    updateSpotlight();

    // Reposition on scroll/resize
    const handleReposition = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSpotlight);
    };
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, currentStep, updateSpotlight]);

  // Keyboard: Esc to close, ← → to navigate
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleClose();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (currentStep < STEPS.length - 1) setCurrentStep(s => s + 1);
        else handleClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (currentStep > 0) setCurrentStep(s => s - 1);
        return;
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentStep]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setCurrentStep(0);
    markDismissedToday();
    onClose?.();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      handleClose();
    }
  }, [currentStep, handleClose]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  }, [currentStep]);

  if (!visible) return null;

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;
  const PAD = 6; // spotlight padding around target

  // Tooltip position calculation
  let tooltipStyle: React.CSSProperties = {};
  if (step.position === "center" || !spotlightRect) {
    tooltipStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  } else if (step.position === "below") {
    const tooltipHeight = 220; // approximate max tooltip height
    const wouldOverflow = spotlightRect.bottom + PAD + 10 + tooltipHeight > window.innerHeight;
    tooltipStyle = {
      position: "fixed",
      left: Math.min(
        Math.max(spotlightRect.left, 12),
        window.innerWidth - 296,
      ),
      ...(wouldOverflow
        ? { bottom: window.innerHeight - spotlightRect.top + PAD + 10 }
        : { top: spotlightRect.bottom + PAD + 10 }),
    };
  } else if (step.position === "right") {
    tooltipStyle = {
      position: "fixed",
      top: spotlightRect.top,
      left: Math.min(spotlightRect.right + PAD + 10, window.innerWidth - 296),
    };
  } else if (step.position === "left") {
    tooltipStyle = {
      position: "fixed",
      top: spotlightRect.top,
      left: Math.max(spotlightRect.left - PAD - 290, 12),
    };
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-[9999]">
      {/* Backdrop — click to close */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-200"
        onClick={handleClose}
      />

      {/* Spotlight cutout */}
      {spotlightRect && (
        <div
          className="absolute border-2 border-teal-500 rounded-md pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: spotlightRect.top - PAD,
            left: spotlightRect.left - PAD,
            width: spotlightRect.width + PAD * 2,
            height: spotlightRect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.50)",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="bg-white rounded-xl shadow-xl w-[280px] pointer-events-auto"
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-2.5 right-2.5 text-gray-400 hover:text-gray-600 p-0.5"
        >
          <X size={14} />
        </button>

        <div className="px-4 pt-3.5 pb-3">
          {/* Step counter */}
          <p className="text-[10px] font-semibold text-teal-600 mb-1">
            Step {currentStep + 1} of {STEPS.length}
          </p>

          {/* Title */}
          <h3 className="text-[14px] font-semibold text-gray-900 mb-1.5">
            {step.title}
          </h3>

          {/* Description — renders HTML for kbd tags */}
          <div
            className="text-[12px] text-gray-500 leading-relaxed mb-3 [&_kbd]:inline-block [&_kbd]:text-[10px] [&_kbd]:font-mono [&_kbd]:bg-gray-100 [&_kbd]:border [&_kbd]:border-gray-200 [&_kbd]:rounded [&_kbd]:px-1.5 [&_kbd]:py-[1px] [&_kbd]:text-gray-700 [&_b]:font-semibold [&_b]:text-gray-700"
            dangerouslySetInnerHTML={{ __html: step.description }}
          />

          {/* Footer: dots + nav buttons */}
          <div className="flex items-center justify-between">
            {/* Dots */}
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`w-[6px] h-[6px] rounded-full transition-colors ${
                    i === currentStep ? "bg-teal-500" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex gap-1.5">
              {currentStep > 0 && (
                <button
                  onClick={handleBack}
                  className="text-[11px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="text-[11px] font-medium text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-md transition-colors"
              >
                {isLast ? "Got it!" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Skip link — always visible */}
      <button
        onClick={handleClose}
        className="fixed top-4 right-4 text-[12px] text-white/70 hover:text-white underline pointer-events-auto"
      >
        Skip tutorial
      </button>
    </div>
  );
}
