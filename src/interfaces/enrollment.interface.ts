export interface Enrollment {
  id: string;
  kid_id: string;
  parent_id: string;
  course_id: string;        // ✅ add this
  course_name: string;
  fee_amount: number;
  billing_cycle: 'monthly' | 'termly' | 'once-off';
  start_date: string;
  status: 'pending' | 'active' | 'cancelled' | 'completed';
  created_at: string;
  updated_at?: string;
  kid_name?: string;
  last_payment_date?: string | null;
  next_payment_date?: string | null;
  total_payments?: number;
  payment_status?: 'unpaid' | 'paid' | 'due_soon' | 'overdue' | 'once-off' | 'cancelled';
}