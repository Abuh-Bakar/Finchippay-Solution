// frontend/lib/onboardingState.ts
"use client";

import { useState } from "react";

export const STORAGE_KEY = "finchippay:onboarding";

export interface OnboardingProgress {
  /** Indices of steps that the user has completed */
  completedSteps: number[];
  /** Whether the entire tour was completed */
  completed: boolean;
  /** Timestamp when the entire tour was completed, or null when incomplete */
  completedAt: number | null;
  /** Whether the user permanently dismissed the tour */
  dismissed: boolean;
  /** Timestamp of the last interaction */
  lastSeen: number;
  /** Feature‑specific version flags to avoid showing stale announcements */
  featureVersions: Record<string, boolean>;
}

function saveProgress(progress: OnboardingProgress): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {}
}

const EMPTY_PROGRESS: OnboardingProgress = {
  completedSteps: [],
  completed: false,
  completedAt: null,
  dismissed: false,
  lastSeen: 0,
  featureVersions: {},
};

export function getTourProgress(): OnboardingProgress {
  if (typeof window === "undefined") {
    return { ...EMPTY_PROGRESS, featureVersions: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY_PROGRESS, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY_PROGRESS, featureVersions: {} };
}

export function markStepComplete(stepIndex: number): void {
  const progress = getTourProgress();
  if (!progress.completedSteps.includes(stepIndex)) {
    progress.completedSteps.push(stepIndex);
  }
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function markTourComplete(): void {
  const progress = getTourProgress();
  progress.completed = true;
  progress.completedAt = Date.now();
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function markTourDismissed(): void {
  const progress = getTourProgress();
  progress.dismissed = true;
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function resetTour(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("finchippay:onboarding:completed");
  localStorage.removeItem("finchippay:onboarding:dismissed");
  localStorage.removeItem("finchippay:onboarding:step");
}

/** Return true if the tour should be shown for the given feature version. */
export function shouldShowTour(featureVersion: string): boolean {
  const progress = getTourProgress();
  if (progress.completed || progress.dismissed || progress.completedAt !== null) return false;
  if (progress.featureVersions[featureVersion]) return false;
  return true;
}

export function markFeatureSeen(featureVersion: string): void {
  const progress = getTourProgress();
  progress.featureVersions[featureVersion] = true;
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

/** Simple analytics – uses Plausible if available */
export function trackOnboardingEvent(event: string, data?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && (window as any).plausible) {
    (window as any).plausible(event, { props: data });
  }
}

/** React hook for easy consumption */
export function useOnboarding() {
  const [progress, setProgress] = useState<OnboardingProgress>(getTourProgress());
  const refresh = () => setProgress(getTourProgress());
  return {
    progress,
    markStepComplete: (i: number) => {
      markStepComplete(i);
      refresh();
    },
    markTourComplete: () => {
      markTourComplete();
      refresh();
    },
    markTourDismissed: () => {
      markTourDismissed();
      refresh();
    },
    resetTour: () => {
      resetTour();
      refresh();
    },
    shouldShowTour,
    markFeatureSeen,
    trackOnboardingEvent,
  };
}
