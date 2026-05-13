// backend/src/interfaces/trial.interface.ts

export interface TrialAccess {
  id: string;
  kid_id: string;
  course_id: string;
  started_at: Date;
  expires_at: Date;
  status: 'active' | 'expired' | 'converted';
  created_at: Date;
  updated_at: Date;
}

export interface TrialWithDetails extends TrialAccess {
  kid_name?: string;
  course_title?: string;
  course_description?: string;
  trial_duration_days: number;
  days_remaining: number;
  is_expiring_soon: boolean;
}

export interface StartTrialDTO {
  kid_id: string;
  course_id: string;
}

export interface TrialStatusResponse {
  hasActiveTrial: boolean;
  trial?: {
    id: string;
    started_at: Date;
    expires_at: Date;
    days_remaining: number;
    duration_days: number;
    is_expiring_soon: boolean;
    kid_name?: string;
    course_title?: string;
  };
}

export interface TrialConversionDTO {
  trial_id: string;
  enrollment_id: string;
}

export interface CourseTrialSettings {
  trial_duration_days: number;
  is_trial_available: boolean;
  trial_message?: string;
}

// For the frontend
export interface FrontendTrialInfo {
  id: string;
  kidId: string;
  courseId: string;
  startedAt: string;
  expiresAt: string;
  daysRemaining: number;
  durationDays: number;
  isExpiringSoon: boolean;
  status: 'active' | 'expired' | 'converted';
  kidName?: string;
  courseTitle?: string;
}

export interface StartTrialRequest {
  kid_id: string;
  course_id: string;
}

export interface StartTrialResponse {
  status: string;
  data: {
    trial: FrontendTrialInfo;
  };
}

export interface CheckTrialResponse {
  status: string;
  data: {
    hasActiveTrial: boolean;
    trial?: FrontendTrialInfo;
  };
}

export interface GetActiveTrialsResponse {
  status: string;
  results: number;
  data: {
    trials: FrontendTrialInfo[];
  };
}

export interface ConvertTrialResponse {
  status: string;
  message: string;
}

// Utility functions for trial calculations
export const calculateDaysRemaining = (expiresAt: Date | string): number => {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
};

export const isExpiringSoon = (expiresAt: Date | string, thresholdDays: number = 2): boolean => {
  const daysRemaining = calculateDaysRemaining(expiresAt);
  return daysRemaining <= thresholdDays && daysRemaining > 0;
};

export const hasTrialExpired = (expiresAt: Date | string): boolean => {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = new Date();
  return expiry < now;
};

export const getTrialProgress = (startedAt: Date | string, expiresAt: Date | string): number => {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = new Date();
  
  const totalDuration = expiry.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  
  if (elapsed <= 0) return 0;
  if (elapsed >= totalDuration) return 100;
  
  return (elapsed / totalDuration) * 100;
};

export const formatTrialTimeRemaining = (expiresAt: Date | string): string => {
  const daysRemaining = calculateDaysRemaining(expiresAt);
  
  if (daysRemaining === 0) {
    return 'Less than 24 hours';
  } else if (daysRemaining === 1) {
    return '1 day';
  } else {
    return `${daysRemaining} days`;
  }
};

export const getTrialStatusMessage = (expiresAt: Date | string): string => {
  const daysRemaining = calculateDaysRemaining(expiresAt);
  
  if (daysRemaining <= 0) {
    return 'Your free trial has expired. Subscribe now to continue learning!';
  } else if (daysRemaining === 1) {
    return 'Your free trial ends tomorrow! Subscribe now to continue your learning journey.';
  } else if (daysRemaining <= 3) {
    return `Your free trial ends in ${daysRemaining} days. Don\'t miss out - subscribe today!`;
  } else {
    return `You have ${daysRemaining} days left in your free trial. Enjoy learning!`;
  }
};