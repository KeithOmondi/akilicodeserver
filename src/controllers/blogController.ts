import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import slugify from 'slugify';

// ─── Helper Functions ────────────────────────────────────────────────────────
const generateSlug = (text: string): string => {
  return slugify(text, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
};

// ─── Blog Posts ──────────────────────────────────────────────────────────────

// Get all published blog posts (public)
export const getPublishedPosts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, category, tag, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        p.*,
        u.name as author_name,
        c.name as category_name,
        c.slug as category_slug,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
           FROM blog_post_tags pt
           JOIN blog_tags t ON t.id = pt.tag_id
           WHERE pt.post_id = p.id),
          '[]'::json
        ) as tags
      FROM blog_posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.status = 'published'
        AND p.published_at <= NOW()
    `;

    const queryParams: any[] = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND c.slug = $${paramIndex}`;
      queryParams.push(category);
      paramIndex++;
    }

    if (tag) {
      query += ` AND EXISTS (
        SELECT 1 FROM blog_post_tags pt 
        JOIN blog_tags t ON t.id = pt.tag_id 
        WHERE pt.post_id = p.id AND t.slug = $${paramIndex}
      )`;
      queryParams.push(tag);
      paramIndex++;
    }

    if (search) {
      query += ` AND (p.title ILIKE $${paramIndex} OR p.excerpt ILIKE $${paramIndex} OR p.content ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY p.published_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await pool.query(query, queryParams);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM blog_posts p WHERE p.status = 'published'`;
    const countParams: any[] = [];
    let countIndex = 1;

    if (category) {
      countQuery += ` AND EXISTS (SELECT 1 FROM blog_categories c WHERE c.slug = $${countIndex} AND c.id = p.category_id)`;
      countParams.push(category);
      countIndex++;
    }

    if (search) {
      countQuery += ` AND (p.title ILIKE $${countIndex} OR p.excerpt ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.status(200).json({
      status: 'success',
      data: {
        posts: result.rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get single blog post by slug
export const getPostBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;

    // Increment view count
    await pool.query(
      `UPDATE blog_posts SET view_count = view_count + 1 WHERE slug = $1`,
      [slug]
    );

    const result = await pool.query(
      `
      SELECT 
        p.*,
        u.name as author_name,
        u.email as author_email,
        c.id as category_id,
        c.name as category_name,
        c.slug as category_slug,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
           FROM blog_post_tags pt
           JOIN blog_tags t ON t.id = pt.tag_id
           WHERE pt.post_id = p.id),
          '[]'::json
        ) as tags
      FROM blog_posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE p.slug = $1 AND p.status = 'published'
      `,
      [slug]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Blog post not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { post: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Get related posts
export const getRelatedPosts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { postId } = req.params;
    const { limit = 3 } = req.query;

    const result = await pool.query(
      `
      SELECT 
        p.id, p.title, p.slug, p.excerpt, p.featured_image, p.published_at,
        u.name as author_name
      FROM blog_posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.id != $1 
        AND p.status = 'published'
        AND (p.category_id = (SELECT category_id FROM blog_posts WHERE id = $1))
      ORDER BY p.published_at DESC
      LIMIT $2
      `,
      [postId, limit]
    );

    res.status(200).json({
      status: 'success',
      data: { posts: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Admin Blog Management ───────────────────────────────────────────────────

// Create blog post (admin only)
export const createBlogPost = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, excerpt, content, featured_image, category_id, status, tags } = req.body;
    const author_id = req.user?.id;

    if (!title || !content) {
      return next(new AppError('Please provide title and content', 400));
    }

    const slug = generateSlug(title);
    const published_at = status === 'published' ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO blog_posts (title, slug, excerpt, content, featured_image, author_id, category_id, status, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, slug, excerpt || null, content, featured_image || null, author_id, category_id || null, status, published_at]
    );

    const postId = result.rows[0].id;

    // Add tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);
        let tagResult = await pool.query(
          `INSERT INTO blog_tags (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [tagName, tagSlug]
        );
        const tagId = tagResult.rows[0].id;
        await pool.query(
          `INSERT INTO blog_post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [postId, tagId]
        );
      }
    }

    res.status(201).json({
      status: 'success',
      data: { post: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Get all blog posts (admin)
export const getAllPosts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        p.*,
        u.name as author_name,
        c.name as category_name
      FROM blog_posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN blog_categories c ON c.id = p.category_id
      WHERE 1=1
    `;

    const queryParams: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await pool.query(query, queryParams);

    res.status(200).json({
      status: 'success',
      data: { posts: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// Update blog post
export const updateBlogPost = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { postId } = req.params;
    const { title, excerpt, content, featured_image, category_id, status, tags } = req.body;

    const slug = title ? generateSlug(title) : undefined;
    const published_at = status === 'published' ? new Date() : null;

    const result = await pool.query(
      `UPDATE blog_posts
       SET title = COALESCE($1, title),
           slug = COALESCE($2, slug),
           excerpt = COALESCE($3, excerpt),
           content = COALESCE($4, content),
           featured_image = COALESCE($5, featured_image),
           category_id = COALESCE($6, category_id),
           status = COALESCE($7, status),
           published_at = CASE WHEN $7 = 'published' AND status != 'published' THEN NOW() ELSE published_at END,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [title || null, slug || null, excerpt || null, content || null, featured_image || null, category_id || null, status || null, postId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Blog post not found', 404));
    }

    // Update tags
    if (tags && tags.length > 0) {
      await pool.query(`DELETE FROM blog_post_tags WHERE post_id = $1`, [postId]);
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);
        let tagResult = await pool.query(
          `INSERT INTO blog_tags (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [tagName, tagSlug]
        );
        const tagId = tagResult.rows[0].id;
        await pool.query(
          `INSERT INTO blog_post_tags (post_id, tag_id) VALUES ($1, $2)`,
          [postId, tagId]
        );
      }
    }

    res.status(200).json({
      status: 'success',
      data: { post: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Delete blog post
export const deleteBlogPost = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { postId } = req.params;

    const result = await pool.query(`DELETE FROM blog_posts WHERE id = $1 RETURNING id`, [postId]);

    if (result.rows.length === 0) {
      return next(new AppError('Blog post not found', 404));
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ─── Categories ─────────────────────────────────────────────────────────────

// Get all categories
export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT c.*, COUNT(p.id) as post_count
       FROM blog_categories c
       LEFT JOIN blog_posts p ON p.category_id = c.id AND p.status = 'published'
       GROUP BY c.id
       ORDER BY c.name ASC`
    );

    res.status(200).json({
      status: 'success',
      data: { categories: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// Create category
export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description } = req.body;
    const slug = generateSlug(name);

    const result = await pool.query(
      `INSERT INTO blog_categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *`,
      [name, slug, description || null]
    );

    res.status(201).json({
      status: 'success',
      data: { category: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Tags ───────────────────────────────────────────────────────────────────

// Get all tags
export const getTags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(pt.post_id) as post_count
       FROM blog_tags t
       LEFT JOIN blog_post_tags pt ON pt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name ASC`
    );

    res.status(200).json({
      status: 'success',
      data: { tags: result.rows }
    });
  } catch (error) {
    next(error);
  }
};