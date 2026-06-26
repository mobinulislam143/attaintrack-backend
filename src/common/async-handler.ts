import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express route handler to forward any rejected promise to
 * the global error handler via `next(err)`.  Eliminates try/catch boilerplate.
 *
 * @example
 * router.get('/example', asyncHandler(async (req, res) => {
 *   const data = await someService.findAll();
 *   res.json(data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
