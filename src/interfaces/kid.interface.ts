



export interface IKid {
  id: string;
  parent_id: string;
  name: string;
  role: 'kid';         // <--- Add this line
  age: number;
  grade?: string;
  avatar?: string;
  username?: string;
  has_pin?: boolean;
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