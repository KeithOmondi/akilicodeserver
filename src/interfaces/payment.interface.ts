// payment.interface.ts
export interface IPayment {
  id: string;
  enrollment_id: string;
  kid_id: string;
  parent_id: string;
  amount: number;
  method: 'M-Pesa' | 'bank_transfer' | 'cash' | 'card';
  reference: string;
  status: 'completed' | 'pending' | 'failed';
  description: string;
  receipt_number: string;
  date: string;
  created_at: string;
}