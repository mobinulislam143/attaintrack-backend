import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import { BadRequestError } from '../../common/errors';
import * as ctrl from './marks.controller';

const router = Router();

// A class list is a few kilobytes; anything larger is a mistake, not a roster.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  // Filter on the extension, not the MIME type: browsers report .csv as
  // text/csv, text/plain or application/vnd.ms-excel depending on the OS, and
  // any of those can equally be attached to a file that is not a CSV at all.
  fileFilter: (_req, file, cb) => {
    if (!/\.csv$/i.test(file.originalname)) {
      cb(new BadRequestError(`${file.originalname} is not a CSV file.`, 'NOT_CSV'));
      return;
    }
    cb(null, true);
  },
});

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.marksRead);
const write = requirePermission(PERMISSIONS.marksWrite);

/** GET /api/v1/marks?assessmentId=... — the grid, one row per enrolled student */
router.get('/', read, asyncHandler(ctrl.getGrid));

/** GET /api/v1/marks/template?assessmentId=... — CSV with the right headers */
router.get('/template', write, asyncHandler(ctrl.downloadTemplate));

/** PUT /api/v1/marks — body: { assessmentId, entries: [{ studentId, questionId, obtained }] } */
router.put('/', write, asyncHandler(ctrl.saveMarks));

/**
 * POST /api/v1/marks/import/validate — multipart: file + assessmentId
 * Writes nothing. Returns every fault with its row number and a token to commit.
 */
router.post('/import/validate', write, upload.single('file'), asyncHandler(ctrl.validateCsv));

/** POST /api/v1/marks/import/commit — body: { uploadToken } */
router.post('/import/commit', write, asyncHandler(ctrl.commitCsv));

export default router;
