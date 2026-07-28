// frontend/lib/onboardingState.ts
"use client";

export const STORAGE_KEY = "finchippay:onboarding";

export interface OnboardingProgress {
  /** Indices of steps that the user has completed */
  completedSteps: number[];
  /** Whether the entire tour was completed */
  completed: boolean;
  /** Timestamp of the last interaction */
  lastSeen: number;
  /** Feature‑specific version flags to avoid showing stale announcements */
  featureVersions: Record<string, boolean>;
}

function getStored(): OnboardingProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(progress: OnboardingProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function getTourProgress(): OnboardingProgress {
  const stored = getStored();
  return (
    stored || {
      completedSteps: [],
      completed: false,
      lastSeen: 0,
      featureVersions: {},
    }
  );
}

export function markStepComplete(stepIndex: number): void {
  const progress = getTourProgress();
  if (!progress.completedSteps.includes(stepIndex)) {
    progress.completedSteps.push(stepIndex);
  }
  progress.lastSeen = Date.now();
  save(progress);
}

export function markTourComplete(): void {
  const progress = getTourProgress();
  progress.completed = true;
  progress.lastSeen = Date.now();
  save(progress);
}

export function resetTour(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Return true if the tour should be shown for the given feature version. */
export function shouldShowTour(featureVersion: string): boolean {
  const progress = getTourProgress();
  if (progress.completed) return false;
  if (progress.featureVersions[featureVersion]) return false;
  return true;
}

export function markFeatureSeen(featureVersion: string): void {
  const progress = getTourProgress();
  progress.featureVersions[featureVersion] = true;
  progress.lastSeen = Date.now();
  save(progress);
}

/** Simple analytics – uses Plausible if available */
export function trackOnboardingEvent(event: string, data?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && (window as any).plausible) {
    (window as any).plausible(event, { props: data });
  }
}

/** React hook for easy consumption */
import { useState } from "react";
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
    resetTour: () => {
      resetTour();
      refresh();
    },
    shouldShowTour,
    markFeatureSeen,
    trackOnboardingEvent,
  };
}

