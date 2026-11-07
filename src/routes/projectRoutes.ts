import { Router } from 'express';
import { isAuthenticated, isAuthorized } from '../middleware/authMiddleware';
import { enforceScreenTime } from '../middleware/screenTime';
import { validate } from '../middleware/validate';
import * as P from '../controllers/projectController';
import * as V from '../validators/project.validators';

/** Mounted at /api/v1/kid/projects (children only). Order matters: fixed paths before /:id. */
export const kidProjectRoutes = Router();
kidProjectRoutes.use(isAuthenticated, isAuthorized('kid'));

kidProjectRoutes.get('/assignments', P.listAssignments);
kidProjectRoutes.get('/', P.listProjects);
kidProjectRoutes.post('/', enforceScreenTime, validate(V.createProjectSchema), P.createProject);
kidProjectRoutes.post('/for-lesson/:lessonId', enforceScreenTime, validate(V.lessonIdParam, 'params'), P.openForLesson);
kidProjectRoutes.get('/:id', validate(V.projectIdParam, 'params'), P.getProject);
kidProjectRoutes.put('/:id', enforceScreenTime, validate(V.projectIdParam, 'params'), validate(V.saveProjectSchema), P.saveProject);
kidProjectRoutes.post('/:id/submit', validate(V.projectIdParam, 'params'), P.submitProject);
kidProjectRoutes.post('/:id/unsubmit', validate(V.projectIdParam, 'params'), P.unsubmitProject);
kidProjectRoutes.delete('/:id', validate(V.projectIdParam, 'params'), P.deleteProject);

/** Mounted at /api/v1/admin/projects (admins only). */
export const adminProjectRoutes = Router();
adminProjectRoutes.use(isAuthenticated, isAuthorized('admin'));
adminProjectRoutes.get('/', validate(V.adminProjectsQuery, 'query'), P.adminListProjects);
adminProjectRoutes.patch('/:id/review', validate(V.projectIdParam, 'params'), validate(V.reviewProjectSchema), P.adminReviewProject);
