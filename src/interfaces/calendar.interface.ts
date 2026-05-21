// src/interfaces/calendar.interface.ts

export type CalendarEventType = 'lesson_completed' | 'submission_submitted' | 'submission_reviewed';

export interface CalendarEvent {
  id: string;          // e.g., progress_id or submission_id
  date: string;        // YYYY-MM-DD
  type: CalendarEventType;
  title: string;
  lesson_id?: string;
  lesson_title?: string;
  points_earned?: number;
  marks?: number | null;
  status?: 'submitted' | 'reviewed';
}

export interface CalendarResponse {
  status: string;
  data: {
    events: CalendarEvent[];
  };
}