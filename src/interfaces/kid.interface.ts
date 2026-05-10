export interface IKid {
  id: string;
  parent_id: string;
  name: string;
  age: number;
  grade?: string;
  avatar?: string;
  username?: string;
  has_pin?: boolean;   // computed — true if pin_hash is set, never expose pin_hash to client
  created_at: Date;
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
  currentKid: IKid | null;  // the logged-in kid (kid session)
  loading: boolean;
  error: string | null;
}