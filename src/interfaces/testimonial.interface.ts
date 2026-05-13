export interface Testimonial {
  id: string;
  parent_id: string;
  kid_id: string;
  enrollment_id: string;
  rating: number;
  title?: string;
  content: string;
  child_name?: string;
  child_age?: number;
  achievement?: string;
  is_verified: boolean;
  is_featured: boolean;
  status: 'pending' | 'approved' | 'rejected';
  admin_note?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  parent_name?: string;
  kid_name?: string;
  course_name?: string;
}

export interface CreateTestimonialDTO {
  kid_id: string;
  rating: number;
  title?: string;
  content: string;
  child_name?: string;
  child_age?: number;
  achievement?: string;
}

export interface UpdateTestimonialDTO {
  rating?: number;
  title?: string;
  content?: string;
  child_name?: string;
  child_age?: number;
  achievement?: string;
  is_featured?: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  admin_note?: string;
}

export interface TestimonialStats {
  total_testimonials: number;
  average_rating: number;
  five_star_count: number;
  four_star_count: number;
  three_star_count: number;
  two_star_count: number;
  one_star_count: number;
}

export interface TestimonialFilters {
  status?: string;
  rating?: number;
  is_featured?: boolean;
  limit?: number;
  offset?: number;
}