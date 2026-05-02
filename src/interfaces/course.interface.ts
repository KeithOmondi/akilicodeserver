export interface Course {
    id: string;
    title: string;
    description: string;
    price: number;
    duration: string;
    category: string;
    image_url?: string;
    is_active: boolean;
    created_at: string;
}

export interface CourseState {
    courses: Course[];
    loading: boolean;
    error: string | null;
}

export interface CoursesListResponse {
    status: string;
    results: number;
    data: {
        courses: Course[];
    };
}