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

import { validate } from '../middleware/validate';
import * as AV from '../validators/admin.validators';
const router = express.Router();
// PHASE2-VALIDATION: authenticate + validate BEFORE the handlers below (Express runs matching routes in order).
router.get('/posts', validate(AV.postsQuery, 'query'), (_req, _res, next) => next());
router.get('/posts/:slug', validate(AV.slugParam, 'params'), (_req, _res, next) => next());
router.get('/posts/:postId/related', validate(AV.postIdParam, 'params'), validate(AV.relatedQuery, 'query'), (_req, _res, next) => next());
router.post('/posts', isAuthenticated, isAuthorized('admin'), validate(AV.createPostSchema), (_req, _res, next) => next());
router.get('/admin/posts', isAuthenticated, isAuthorized('admin'), validate(AV.postsQuery, 'query'), (_req, _res, next) => next());
router.patch('/posts/:postId', isAuthenticated, isAuthorized('admin'), validate(AV.postIdParam, 'params'), validate(AV.updatePostSchema), (_req, _res, next) => next());
router.delete('/posts/:postId', isAuthenticated, isAuthorized('admin'), validate(AV.postIdParam, 'params'), (_req, _res, next) => next());
router.post('/categories', isAuthenticated, isAuthorized('admin'), validate(AV.createCategorySchema), (_req, _res, next) => next());


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