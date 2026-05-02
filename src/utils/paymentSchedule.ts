/**
 * Kenyan School Terms:
 * Term 1: January – March    → next due: April 1
 * Term 2: May – July         → next due: August 1
 * Term 3: September – November → next due: December 1
 */

export type BillingCycle = 'monthly' | 'termly' | 'once-off';

export const calculateNextPaymentDate = (
  lastPaymentDate: Date,
  billingCycle: BillingCycle
): Date | null => {
  const date = new Date(lastPaymentDate);

  switch (billingCycle) {
    case 'monthly': {
      // Next payment is exactly 1 month after last payment
      const next = new Date(date);
      next.setMonth(next.getMonth() + 1);
      return next;
    }

    case 'termly': {
      // Find next Kenyan term start date after last payment
      const month = date.getMonth(); // 0-indexed

      // Term boundaries (month the next payment is due)
      // After Term 1 (Jan-Mar) → due April (month 3)
      // After Term 2 (May-Jul) → due August (month 7)
      // After Term 3 (Sep-Nov) → due December (month 11)

      let nextDueMonth: number;
      let nextDueYear = date.getFullYear();

      if (month >= 0 && month <= 2) {
        // Paid in Jan-Mar → next due April
        nextDueMonth = 3;
      } else if (month >= 3 && month <= 6) {
        // Paid in Apr-Jul → next due August
        nextDueMonth = 7;
      } else if (month >= 7 && month <= 10) {
        // Paid in Aug-Nov → next due December
        nextDueMonth = 11;
      } else {
        // Paid in December → next due April next year
        nextDueMonth = 3;
        nextDueYear += 1;
      }

      return new Date(nextDueYear, nextDueMonth, 1);
    }

    case 'once-off':
      // No next payment
      return null;

    default:
      return null;
  }
};

export const getPaymentStatus = (nextPaymentDate: Date | null): 'paid' | 'due_soon' | 'overdue' | 'once-off' => {
  if (!nextPaymentDate) return 'once-off';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(nextPaymentDate);
  due.setHours(0, 0, 0, 0);

  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 7) return 'due_soon';
  return 'paid';
};