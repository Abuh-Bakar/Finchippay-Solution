"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/lib/useWallet";
import { getTourProgress, markStepComplete, markTourComplete, trackOnboardingEvent } from "@/lib/onboardingState";

interface TourStep {
  id: string;
  title: string;
  description: string;
  target: string;
  position: "top" | "bottom" | "left" | "right";
  condition?: () => boolean;
}

const tourSteps: TourStep[] = [
  {
    id: "dashboard",
    title: "Dashboard Overview",
    description: "This is your dashboard where you can see your balance and recent activity.",
    target: "a[href='/dashboard']",
    position: "bottom",
  },
  {
    id: "connect-wallet",
    title: "Connect Your Wallet",
    description: "Click here to connect your Stellar wallet and start making payments.",
    target: ".connect-wallet-btn",
    position: "bottom",
    condition: () => {
      try {
        const { publicKey } = useWallet();
        return !publicKey;
      } catch {
        return true;
      }
    },
  },
  {
    id: "send-payment",
    title: "Send Your First Payment",
    description: "Use the send payment form to send XLM to anyone with a Stellar address.",
    target: ".send-payment-form",
    position: "right",
  },
  {
    id: "transactions",
    title: "View Transactions",
    description: "Click here to see all your past transactions and payment history.",
    target: "a[href='/transactions']",
    position: "bottom",
  },
];

interface OnboardingTourProps {
  tour: {
    isVisible: boolean;
    currentStep: number;
    totalSteps: number;
    progress: number;
    startTour: () => void;
    nextStep: () => void;
    prevStep: () => void;
    skipTour: () => void;
    completeTour: () => void;
  };
}

export default function OnboardingTour({ tour }: OnboardingTourProps) {
  const { isVisible, currentStep, totalSteps, nextStep, skipTour, completeTour, progress } = tour;

  useEffect(() => {
    if (!isVisible) return;
    trackOnboardingEvent("onboarding_started");
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const step = tourSteps[currentStep];
    if (!step) return;
    const targetElement = document.querySelector(step.target);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      targetElement.classList.add("tour-highlight");
    }
    return () => {
      if (targetElement) targetElement.classList.remove("tour-highlight");
    };
  }, [currentStep, isVisible]);

  if (!isVisible) return null;

  const step = tourSteps[currentStep];
  if (!step) return null;

  const targetElement = document.querySelector(step.target);
  if (!targetElement) return null;

  const rect = targetElement.getBoundingClientRect();

  const getTooltipPosition = () => {
    const offset = 10;
    switch (step.position) {
      case "top": return { top: rect.top - offset, left: rect.left + rect.width / 2, transform: "translateX(-50%) translateY(-100%)" };
      case "bottom": return { top: rect.bottom + offset, left: rect.left + rect.width / 2, transform: "translateX(-50%)" };
      case "left": return { top: rect.top + rect.height / 2, left: rect.left - offset, transform: "translateX(-100%) translateY(-50%)" };
      case "right": return { top: rect.top + rect.height / 2, left: rect.right + offset, transform: "translateY(-50%)" };
    }
  };

  const handleNext = () => {
    markStepComplete(currentStep);
    trackOnboardingEvent("onboarding_step_completed", { step: currentStep, stepName: step.id });
    if (currentStep < totalSteps - 1) {
      nextStep();
    } else {
      markTourComplete();
      trackOnboardingEvent("onboarding_completed");
      completeTour();
    }
  };

  const handleSkip = () => {
    trackOnboardingEvent("onboarding_skipped", { step: currentStep });
    skipTour();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 pointer-events-none" />
      <div className="fixed z-50 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-4 rounded-lg shadow-lg max-w-xs" style={getTooltipPosition()}>
        <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
        <p className="text-sm mb-3">{step.description}</p>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-3">
          <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between items-center">
          <button onClick={handleSkip} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Skip tour</button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{currentStep + 1} of {totalSteps}</span>
            <button onClick={handleNext} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm">
              {currentStep === totalSteps - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
