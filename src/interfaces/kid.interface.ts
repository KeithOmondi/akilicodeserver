export interface IKid {
  id: string;
  parent_id: string;
  name: string;
  role: 'kid';
  age: number;
  grade?: string;
  avatar?: string;
  username?: string;
  has_pin?: boolean;
  created_at: Date;

  // SECURITY — used in loginKid, updateKidPin, unlockKidPin
  hashed_pin?: string;
  pin_failed_attempts?: number;
  pin_locked_until?: Date;
  last_kid_login_at?: Date;
  last_kid_login_ip?: string;

  // SESSION — used in updateKidSessionTimeout
  session_timeout_minutes?: number;
}

export interface KidLoginPayload {
  username: string;
  pin: string;
}

export interface SetKidLoginPayload {
  username: string;
  pin: string;
}

export interface KidState {
  kids: IKid[];
  currentKid: IKid | null;
  loading: boolean;
  error: string | null;
}