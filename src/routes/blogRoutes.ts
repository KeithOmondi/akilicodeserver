import express from 'express';
import {
  getPublishedPosts,
  getPostBySlug,
  getRelatedPosts,
  getCategories,
  getTags,
  createBlogPost,
  getAllPosts,
  updateBlogPost,
  deleteBlogPost,
  createCategory
} from '../controllers/blogController';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';

const router = express.Router();

// Public routes
router.get('/posts', getPublishedPosts);
router.get('/posts/:slug', getPostBySlug);
router.get('/posts/:postId/related', getRelatedPosts);
router.get('/categories', getCategories);
router.get('/tags', getTags);

// Admin only routes
router.use(isAuthenticated);
router.use(isAuthorized('admin'));

router.post('/posts', createBlogPost);
router.get('/admin/posts', getAllPosts);
router.patch('/posts/:postId', updateBlogPost);
router.delete('/posts/:postId', deleteBlogPost);
router.post('/categories', createCategory);

export default router;