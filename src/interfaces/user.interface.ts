export type UserRole = 'admin' | 'parent' | 'kid';
export type ConsentMethod = 'credit_card' | 'email_plus' | 'signed_form' | 'video_call' | 'knowledge_auth';

export interface IUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: UserRole;
  is_verified: boolean;
  created_at: Date;         // was createdAt — matches DB column and controller

  // DELETION/RETENTION
  deletion_requested_at?: Date;
  deletion_completed_at?: Date;
  retention_policy_applied?: string;
  anonymized_at?: Date;

  // SECURITY
  two_factor_enabled?: boolean;
  two_factor_secret?: string;
  login_attempts?: number;
  locked_until?: Date;
  last_login_ip?: string;
  last_login_at?: Date;
  email_verification_token?: string;
  email_verified_at?: Date;
  reset_password_token?: string;
  reset_password_expires?: Date;
}

export interface IJWTPayload {
  id: string;
  name: string;
  role: UserRole;
  phone?: string;
  kid_id?: string;
  parent_id?: string;
  username?: string;
  iat?: number;
  exp?: number;
}

export interface IParentalConsentRecord {
  id: string;
  parent_id: string;
  kid_id: string;
  method: ConsentMethod;
  method_details: string;
  granted_at: Date;
  granted_ip: string;
  user_agent: string;
  version_of_policy: string;
  coppa_compliant: boolean;
  revoked_at?: Date;
  revoked_reason?: string;
  consented_to_analytics: boolean;
  consented_to_third_party: boolean;
  consented_to_personalization: boolean;
  consented_to_ip_collection: boolean;
}