export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  featured_image?: string;
  author_id: string;
  author_name?: string;
  author_email?: string;
  category_id?: string;
  category_name?: string;
  category_slug?: string;
  status: 'draft' | 'published' | 'archived';
  view_count: number;
  published_at?: Date;
  created_at: Date;
  updated_at: Date;
  tags?: BlogTag[];
}

export interface BlogPostWithDetails extends BlogPost {
  tags: BlogTag[];
  category: BlogCategory | null;
  author: {
    id: string;
    name: string;
    email: string;
  };
}

export interface CreateBlogPostDTO {
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  featured_image?: string;
  category_id?: string;
  status: 'draft' | 'published';
  tags?: string[];
}

export interface UpdateBlogPostDTO extends Partial<CreateBlogPostDTO> {}

export interface CreateBlogCategoryDTO {
  name: string;
  slug: string;
  description?: string;
}

export interface CreateBlogTagDTO {
  name: string;
  slug: string;
}