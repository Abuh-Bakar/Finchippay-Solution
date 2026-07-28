const STORAGE_KEY = "finchippay:onboarding";

export interface OnboardingProgress {
  completedSteps: number[];
  completed: boolean;
  lastSeen: number;
  featureVersions: Record<string, boolean>;
}

export function getTourProgress(): OnboardingProgress {
  if (typeof window === "undefined") return { completedSteps: [], completed: false, lastSeen: 0, featureVersions: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { completedSteps: [], completed: false, lastSeen: 0, featureVersions: {} };
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
  progress.lastSeen = Date.now();
  saveProgress(progress);
}

export function resetTour(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function shouldShowTour(featureVersion: string): boolean {
  const progress = getTourProgress();
  if (progress.completed) return false;
  if (progress.featureVersions[featureVersion]) return false;
  return true;
}

export function markFeatureSeen(featureVersion: string): void {
  const progress = getTourProgress();
  progress.featureVersions[featureVersion] = true;
  saveProgress(progress);
}

function saveProgress(progress: OnboardingProgress): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function trackOnboardingEvent(event: string, data?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && (window as any).plausible) {
    (window as any).plausible(event, { props: data });
  }
}