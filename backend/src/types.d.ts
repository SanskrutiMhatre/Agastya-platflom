// Request augmentation: the guards in core/auth/authz.js attach these.
declare global {
  namespace Express {
    interface Request {
      /** { user, session } resolved from the session cookie. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth?: any;
      /** { id, dir, role, row } set by requireProject(). */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      project?: any;
    }
  }
}
export {};
